import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, FilePlus2, FileText, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useComplianceAlerts } from "@/hooks/useComplianceAlerts";
import { queryKeys } from "@/lib/queryKeys";
import { COMPLIANCE_KINDS, complianceAlertTitle, daysUntilExpiry, fetchHrComplianceEntries, listComplianceRecords } from "@/lib/compliance/complianceService";

export default function ComplianceRegisterPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id || "";
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const records = useQuery({
    queryKey: queryKeys.compliance.list(tenantId, { page, kind, status }),
    queryFn: () => listComplianceRecords(tenantId, page, kind, status),
    enabled: !!tenantId,
    staleTime: 30_000,
  });
  const hr = useQuery({
    queryKey: queryKeys.compliance.hrEntries(tenantId),
    queryFn: () => fetchHrComplianceEntries(tenantId),
    enabled: !!tenantId,
    staleTime: 60_000,
  });
  const alerts = useComplianceAlerts(tenantId);
  const hasExpired = alerts.alerts.some((item) => daysUntilExpiry(item.expiresOn) < 0);
  const kindName = (value: string) => {
    const found = COMPLIANCE_KINDS.find((item) => item.value === value);
    return found ? (isAr ? found.ar : found.en) : value;
  };
  const deadlineLabel = (expiresOn: string) => {
    const days = daysUntilExpiry(expiresOn);
    if (days < 0) return isAr ? `منتهي منذ ${Math.abs(days)} يوم` : `Expired ${Math.abs(days)} days ago`;
    if (days === 0) return isAr ? "ينتهي اليوم" : "Expires today";
    return isAr ? `باقي ${days} يوم` : `${days} days left`;
  };

  return <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6" dir={isAr ? "rtl" : "ltr"}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold">{isAr ? "التراخيص والعقود" : "Licences & Contracts"}</h1>
        <p className="text-sm text-muted-foreground">{isAr ? "متابعة الوثائق وتجديدها قبل الانتهاء بثلاثة أشهر" : "Track documents and renewals three months before expiry"}</p></div>
      <Button asChild><Link to="/compliance/new"><FilePlus2 className="me-2 h-4 w-4"/>{isAr ? "إضافة وثيقة" : "Add document"}</Link></Button>
    </div>

    <Card className={alerts.total ? "border-amber-500/60 bg-amber-500/5" : ""}>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-5 w-5 text-amber-600"/>
        {isAr ? "تنبيهات التجديد" : "Renewal alerts"}
        {!alerts.isLoading && !alerts.isError && <Badge variant={alerts.total ? "destructive" : "secondary"}>{alerts.total}</Badge>}
      </CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {alerts.isLoading && (isAr ? "جاري جلب التنبيهات..." : "Loading alerts...")}
        {alerts.isError && <p className="text-destructive">{isAr ? "تعذر تحميل التنبيهات. تحقق من الاتصال وأعد المحاولة." : "Could not load alerts. Check the connection and retry."}</p>}
        {!alerts.isLoading && !alerts.isError && alerts.total === 0 && (isAr ? "لا توجد وثائق مسجلة تنتهي خلال ثلاثة أشهر." : "No registered documents expire within three months.")}
        {!alerts.isError && alerts.total > 0 && <>
          <p className="font-medium text-amber-800 dark:text-amber-300">{isAr ? `${alerts.total} تستحق المتابعة${hasExpired ? "؛ بينها وثائق منتهية" : ""}` : `${alerts.total} need attention${hasExpired ? "; some have expired" : ""}`}</p>
          <div className="grid gap-2 md:grid-cols-2">
            {alerts.alerts.slice(0, 8).map((item) => <Link key={item.id} to={item.href} className="rounded-md border bg-background p-3 hover:border-primary">
              <span className="block font-medium">{complianceAlertTitle(item, isAr)}</span><span className="text-xs text-muted-foreground">{item.expiresOn} · {deadlineLabel(item.expiresOn)}</span>
            </Link>)}
          </div>
          {alerts.total > 8 && <p className="text-xs text-muted-foreground">{isAr ? "تظهر أول ثمانية تنبيهات هنا؛ راجع القائمة أدناه لباقي الوثائق." : "The first eight alerts appear here; review the lists below for the rest."}</p>}
        </>}
      </CardContent>
    </Card>

    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-base"><FileText className="h-4 w-4"/>{isAr ? "وثائق الشركة وتصاريح العمال" : "Company documents & worker permits"}</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Select value={kind} onValueChange={(value) => { setKind(value); setPage(1); }}><SelectTrigger className="w-48"><SelectValue/></SelectTrigger><SelectContent>
            <SelectItem value="all">{isAr ? "كل الأنواع" : "All types"}</SelectItem>
            {COMPLIANCE_KINDS.map((item) => <SelectItem key={item.value} value={item.value}>{isAr ? item.ar : item.en}</SelectItem>)}
          </SelectContent></Select>
          <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}><SelectTrigger className="w-36"><SelectValue/></SelectTrigger><SelectContent>
            <SelectItem value="all">{isAr ? "كل الحالات" : "All statuses"}</SelectItem><SelectItem value="active">{isAr ? "سارية" : "Active"}</SelectItem><SelectItem value="closed">{isAr ? "مغلقة" : "Closed"}</SelectItem>
          </SelectContent></Select>
          <Button type="button" variant="outline" size="icon" onClick={() => { void records.refetch(); void hr.refetch(); }} aria-label={isAr ? "تحديث" : "Refresh"}><RefreshCw className="h-4 w-4"/></Button>
        </div>
      </CardHeader>
      <CardContent>
        {records.isError && <p className="mb-3 text-sm text-destructive">{isAr ? "تعذر جلب الوثائق؛ لم تُعرض بيانات قديمة على أنها حديثة." : "Could not load documents; stale data is not presented as current."}</p>}
        <div className="overflow-x-auto"><Table><TableHeader><TableRow>
          {[isAr ? "الوثيقة" : "Document", isAr ? "النوع" : "Type", isAr ? "الرقم المرجعي" : "Reference", isAr ? "العامل" : "Employee", isAr ? "الانتهاء" : "Expiry", isAr ? "الحالة" : "Status"].map((heading) => <TableHead key={heading}>{heading}</TableHead>)}
        </TableRow></TableHeader><TableBody>
          {records.isLoading && <TableRow><TableCell colSpan={6}>{isAr ? "جاري التحميل..." : "Loading..."}</TableCell></TableRow>}
          {!records.isLoading && !records.isError && !records.data?.rows.length && <TableRow><TableCell colSpan={6}>{isAr ? "لا توجد وثائق مطابقة" : "No matching documents"}</TableCell></TableRow>}
          {!records.isError && records.data?.rows.map((record) => <TableRow key={record.id}>
            <TableCell><Link className="font-medium text-primary hover:underline" to={`/compliance/${record.id}`}>{record.title}</Link></TableCell>
            <TableCell>{kindName(record.kind)}</TableCell><TableCell>{record.reference_number || "—"}</TableCell><TableCell>{record.employee_name || "—"}</TableCell>
            <TableCell className="whitespace-nowrap">{record.expires_on}<span className="block text-xs text-muted-foreground">{record.status === "active" ? deadlineLabel(record.expires_on) : "—"}</span></TableCell>
            <TableCell><Badge variant={record.status === "closed" ? "secondary" : daysUntilExpiry(record.expires_on) < 0 ? "destructive" : "outline"}>{record.status === "closed" ? (isAr ? "مغلقة" : "Closed") : (isAr ? "سارية" : "Active")}</Badge></TableCell>
          </TableRow>)}
        </TableBody></Table></div>
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground"><span>{records.data?.total || 0} {isAr ? "سجل" : "records"}</span><div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{isAr ? "السابق" : "Previous"}</Button>
          <Button variant="outline" size="sm" disabled={page * (records.data?.size || 50) >= (records.data?.total || 0)} onClick={() => setPage(page + 1)}>{isAr ? "التالي" : "Next"}</Button>
        </div></div>
      </CardContent>
    </Card>

    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="h-4 w-4"/>{isAr ? "عقود ومستندات الموظفين" : "Employee contracts & documents"}</CardTitle>
      <p className="text-sm text-muted-foreground">{isAr ? "تُقرأ مباشرة من ملف الموظف؛ جدّدها هناك كي لا تتكرر البيانات." : "Read directly from employee profiles. Renew there to avoid duplicate records."}</p>
    </CardHeader><CardContent>
      {hr.isLoading && <p className="text-sm">{isAr ? "جاري التحميل..." : "Loading..."}</p>}
      {hr.isError && <p className="text-sm text-destructive">{isAr ? "تعذر تحميل عقود الموظفين." : "Could not load employee contracts."}</p>}
      {!hr.isLoading && !hr.isError && !hr.data?.length && <p className="text-sm text-muted-foreground">{isAr ? "لا توجد عقود أو مستندات مؤرخة في ملفات الموظفين." : "No dated contracts or documents in employee profiles."}</p>}
      {!hr.isError && !!hr.data?.length && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{hr.data.map((item) => <Link key={item.id} to={item.href} className="rounded-md border p-3 hover:border-primary">
        <span className="block font-medium">{complianceAlertTitle(item, isAr)}</span><span className="text-xs text-muted-foreground">{item.expiresOn} · {deadlineLabel(item.expiresOn)}</span>
      </Link>)}</div>}
    </CardContent></Card>
  </div>;
}
