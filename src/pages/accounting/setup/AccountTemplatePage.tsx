import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { accountingQueryKeys } from "@/lib/accounting/accountingQueryKeys";
import { createAccountingAccount, listAccountingAccounts } from "@/lib/accounting/accountingAccountsService";
import type { AccountingAccountType } from "@/lib/accounting/accountingTypes";
import { WORKSHOP_ACCOUNTS } from "./AccountingSetupPages";

type TemplateRow = {
  code: string;
  nameAr: string;
  nameEn: string;
  accountType: AccountingAccountType;
  isPostable: boolean;
  parentCode: string;
};

function parentCodeFor(code: string): string {
  if (["1000", "2000", "3000", "4000", "5000", "6000"].includes(code)) return "";
  if (["1100", "1200", "1300", "1400", "1500"].includes(code)) return "1000";
  if (["1110", "1120"].includes(code)) return "1100";
  if (["1210", "1220"].includes(code)) return "1200";
  if (code === "1590") return "1500";
  return `${code.charAt(0)}000`;
}

const INITIAL_ROWS: TemplateRow[] = WORKSHOP_ACCOUNTS.map(([code, nameAr, nameEn, accountType, isPostable]) => ({
  code,
  nameAr,
  nameEn,
  accountType,
  isPostable,
  parentCode: parentCodeFor(code),
}));

export default function AccountTemplatePage() {
  const { i18n } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const tenantId = profile?.tenant_id;
  const english = i18n.resolvedLanguage?.startsWith("en");
  const text = (ar: string, en: string) => english ? en : ar;
  const BackIcon = i18n.dir() === "rtl" ? ArrowRight : ArrowLeft;
  const [confirmed, setConfirmed] = useState(false);
  const [rows, setRows] = useState<TemplateRow[]>(() => INITIAL_ROWS.map((row) => ({ ...row })));

  const validation = useMemo(() => {
    const codes = rows.map((row) => row.code.trim()).filter(Boolean);
    const uniqueCodes = new Set(codes);
    const missingParent = rows.some((row) => row.parentCode.trim() && !uniqueCodes.has(row.parentCode.trim()));
    return {
      valid: codes.length === rows.length && uniqueCodes.size === rows.length && !missingParent && rows.every((row) => row.nameAr.trim() && row.nameEn.trim()),
      duplicateCode: uniqueCodes.size !== codes.length,
      missingParent,
    };
  }, [rows]);

  function updateRow<K extends keyof TemplateRow>(index: number, key: K, value: TemplateRow[K]) {
    setConfirmed(false);
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  }

  const apply = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("ACCOUNTING_TENANT_REQUIRED");
      if (!validation.valid) throw new Error("ACCOUNTING_TEMPLATE_VALIDATION_FAILED");
      const existing = await listAccountingAccounts(tenantId);
      const accountsByCode = new Map(existing.map((account) => [account.code, account]));
      for (const row of rows) {
        const code = row.code.trim();
        if (accountsByCode.has(code)) continue;
        const parentId = row.parentCode.trim() ? accountsByCode.get(row.parentCode.trim())?.id : null;
        const created = await createAccountingAccount({
          tenantId,
          code,
          nameAr: row.nameAr.trim(),
          nameEn: row.nameEn.trim(),
          parentId: parentId || null,
          accountType: row.accountType,
          normalBalance: ["asset", "expense", "cost_of_revenue"].includes(row.accountType) ? "debit" : "credit",
          isPostable: row.isPostable,
        });
        accountsByCode.set(code, created);
      }
    },
    onSuccess: () => {
      if (tenantId) queryClient.invalidateQueries({ queryKey: accountingQueryKeys.accounts(tenantId) });
      toast.success(text("تم تطبيق القالب التجريبي", "Template applied"));
    },
    onError: (error) => toast.error(String((error as Error).message)),
  });

  return <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6" dir={i18n.dir()}>
    <header className="flex flex-col gap-3 border-b pb-4 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-3">
        <Button variant="outline" size="icon" asChild><Link to="/accounting/setup/accounts"><BackIcon className="h-4 w-4" /></Link></Button>
        <div><h1 className="text-2xl font-bold">{text("قالب دليل الحسابات للورشة", "Workshop Chart Template")}</h1><p className="mt-1 text-sm text-muted-foreground">{text("يمكن تعديل القالب قبل تأكيد التطبيق اليدوي.", "Edit the template before confirming manual application.")}</p></div>
      </div>
      <Button disabled={!tenantId || !confirmed || !validation.valid || apply.isPending} onClick={() => apply.mutate()}>{text("تطبيق على Tenant Development", "Apply to Development tenant")}</Button>
    </header>

    <div className="space-y-2 rounded-lg border p-3">
      <label className="flex items-center gap-2"><Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(Boolean(value))}/>{text("راجعت القالب وأؤكد التطبيق اليدوي", "I reviewed the template and confirm manual application")}</label>
      {!validation.valid && <p className="text-sm text-destructive">{validation.duplicateCode ? "Duplicate account code" : validation.missingParent ? "Missing parent account code" : "Complete every required field"}</p>}
    </div>

    <div className="overflow-x-auto rounded-lg border">
      <table className="min-w-[980px] w-full text-sm">
        <thead className="bg-muted"><tr><th className="p-2">Code</th><th>{text("الاسم العربي", "Arabic name")}</th><th>{text("الاسم الإنجليزي", "English name")}</th><th>{text("الحساب الأب", "Parent account")}</th><th>Type</th><th>Postable</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={`${index}-${row.code}`} className="border-t">
          <td className="p-2"><Input className="font-mono" value={row.code} onChange={(event) => updateRow(index, "code", event.target.value)}/></td>
          <td className="p-2"><Input value={row.nameAr} onChange={(event) => updateRow(index, "nameAr", event.target.value)}/></td>
          <td className="p-2"><Input dir="ltr" value={row.nameEn} onChange={(event) => updateRow(index, "nameEn", event.target.value)}/></td>
          <td className="p-2"><Input className="font-mono" value={row.parentCode} onChange={(event) => updateRow(index, "parentCode", event.target.value)}/></td>
          <td className="p-2"><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={row.accountType} onChange={(event) => updateRow(index, "accountType", event.target.value as AccountingAccountType)}>{["asset", "liability", "equity", "revenue", "cost_of_revenue", "expense"].map((type) => <option key={type}>{type}</option>)}</select></td>
          <td className="p-2 text-center"><Checkbox checked={row.isPostable} onCheckedChange={(value) => updateRow(index, "isPostable", Boolean(value))}/></td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
