import { Bell, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNavigate } from "react-router-dom";
import { useOverdueInsuranceAlerts } from "@/hooks/useOverdueInsuranceAlerts";

export default function InsuranceOverdueBell() {
  const navigate = useNavigate();
  const overdue = useOverdueInsuranceAlerts();
  const count = overdue.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="تنبيهات تأخر السداد">
          <Bell size={18} />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0" dir="rtl">
        <div className="p-3 border-b border-border bg-secondary/30">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <AlertTriangle size={16} className="text-destructive" />
            شركات تأمين متأخرة عن السداد
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            تجاوزت مدة السداد المحددة (payment terms) ولها أرصدة معلقة.
          </p>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {count === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              ✓ لا توجد متأخرات حالياً
            </div>
          ) : overdue.map((o, i) => (
            <button
              key={i}
              onClick={() => o.companyId && navigate(`/insurance/companies/${o.companyId}`)}
              className="w-full text-right p-3 border-b border-border hover:bg-secondary/30 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-sm">{o.name}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/15 text-destructive font-bold">
                  {o.oldestDays} يوم
                </span>
              </div>
              <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
                <span>{o.claimsCount} مطالبة</span>
                <span className="font-bold text-warning">{o.remaining.toLocaleString()} ر.ع</span>
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                مدة السداد المتفق عليها: {o.termsDays} يوم
              </div>
            </button>
          ))}
        </div>
        {count > 0 && (
          <div className="p-2 border-t border-border bg-secondary/20">
            <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => navigate("/insurance/payments")}>
              فتح لوحة المدفوعات الكاملة ←
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
