// عرض القيود المحاسبية في صورة جدول قابل للمعاينة قبل/بعد الحفظ
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeftRight } from "lucide-react";
import type { JournalEntry } from "@/lib/journalStore";

export interface JournalPreviewLine {
  /** اختياري — لتمييز القيود المحفوظة عن القيود المتوقعة */
  pending?: boolean;
  date: string;
  debitAccount: string;
  creditAccount: string;
  amount: number;
  description: string;
  reference?: string;
}

interface Props {
  title?: string;
  lines: JournalPreviewLine[];
  emptyMessage?: string;
}

export default function JournalPreview({ title = "القيود المحاسبية", lines, emptyMessage = "لا توجد قيود" }: Props) {
  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  return (
    <Card className="overflow-hidden">
      <div className="p-3 border-b border-border bg-secondary/30 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ArrowLeftRight size={14} className="text-primary" />
          {title}
        </div>
        <span className="text-xs text-muted-foreground">
          إجمالي القيود: <strong className="text-foreground">{lines.length}</strong>
          {total > 0 && (
            <> • مجموع المبالغ: <strong className="text-foreground">{total.toLocaleString()} ر.ع</strong></>
          )}
        </span>
      </div>
      {lines.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">{emptyMessage}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/20">
                <th className="text-right py-2 px-3 text-xs text-muted-foreground">التاريخ</th>
                <th className="text-right py-2 px-3 text-xs text-muted-foreground">مدين</th>
                <th className="text-right py-2 px-3 text-xs text-muted-foreground">دائن</th>
                <th className="text-right py-2 px-3 text-xs text-muted-foreground">المبلغ</th>
                <th className="text-right py-2 px-3 text-xs text-muted-foreground">الوصف</th>
                <th className="text-right py-2 px-3 text-xs text-muted-foreground">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b border-border/50 hover:bg-secondary/10">
                  <td className="py-2 px-3 text-xs">{l.date}</td>
                  <td className="py-2 px-3"><Badge variant="outline" className="font-mono text-[11px]">{l.debitAccount}</Badge></td>
                  <td className="py-2 px-3"><Badge variant="outline" className="font-mono text-[11px]">{l.creditAccount}</Badge></td>
                  <td className="py-2 px-3 font-semibold">{Number(l.amount).toLocaleString()} ر.ع</td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">{l.description}</td>
                  <td className="py-2 px-3">
                    {l.pending ? (
                      <Badge className="bg-warning/15 text-warning text-[10px]">معاينة (سيُسجَّل)</Badge>
                    ) : (
                      <Badge className="bg-success/15 text-success text-[10px]">مرحَّل</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** محوّل من JournalEntry (المحفوظة في journalStore) → سطر معاينة */
export function entryToPreviewLine(e: JournalEntry): JournalPreviewLine {
  return {
    pending: false,
    date: e.date,
    debitAccount: e.debitAccount,
    creditAccount: e.creditAccount,
    amount: e.amount,
    description: `${e.description}${e.sourceId ? ` — ${e.sourceId}` : ""}`,
  };
}
