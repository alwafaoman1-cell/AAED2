import { useEffect, useMemo, useState } from "react";
import { smartBack } from "@/lib/smartBack";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowRight, Package, ArrowDown, ArrowUp, ArrowLeftRight, Edit, Trash2,
  Tag, Boxes, Barcode, MapPin, AlertTriangle, TrendingUp, Calendar, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from "recharts";
import { inventoryStore, type Part } from "@/lib/inventoryStore";
import { stockMovementsStore, type StockMovement, type MovementType } from "@/lib/stockMovementsStore";

export default function InventoryDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [part, setPart] = useState<Part | undefined>(() => (id ? inventoryStore.getById(id) : undefined));
  const [movements, setMovements] = useState<StockMovement[]>(stockMovementsStore.getAll());

  useEffect(() => {
    const u1 = inventoryStore.subscribe(() => {
      if (id) setPart(inventoryStore.getById(id));
    });
    const u2 = stockMovementsStore.subscribe(() => setMovements([...stockMovementsStore.getAll()]));
    return () => { u1(); u2(); };
  }, [id]);

  // حركات هذا الصنف فقط
  const partMovements = useMemo(() => {
    if (!id) return [];
    return movements
      .filter((m) => m.items.some((it) => it.partId === id))
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  }, [movements, id]);

  // حساب الرصيد بعد كل حركة (تراكمي)
  const movementHistory = useMemo(() => {
    if (!part) return [];
    // الرصيد الحالي = آخر رصيد. نحسب رصيد البداية بالعكس
    const currentStock = part.stock;
    const totalDelta = partMovements.reduce((sum, m) => {
      const item = m.items.find((it) => it.partId === id);
      if (!item) return sum;
      if (m.type === "IN") return sum + item.qty;
      if (m.type === "OUT") return sum - item.qty;
      return sum; // TRANSFER لا يغير الكمية
    }, 0);
    let running = currentStock - totalDelta;
    const startBalance = running;
    const rows = partMovements.map((m) => {
      const item = m.items.find((it) => it.partId === id)!;
      const before = running;
      let delta = 0;
      if (m.type === "IN") delta = item.qty;
      else if (m.type === "OUT") delta = -item.qty;
      running += delta;
      return {
        movement: m,
        item,
        before,
        delta,
        after: running,
      };
    });
    return { rows, startBalance };
  }, [partMovements, part, id]);

  // بيانات المخطط (تراكمي عبر الزمن)
  const chartData = useMemo(() => {
    if (!movementHistory || !("rows" in movementHistory)) return [];
    const points = [
      { date: "البداية", balance: movementHistory.startBalance },
      ...movementHistory.rows.map((r) => ({
        date: r.movement.date,
        balance: r.after,
      })),
    ];
    return points;
  }, [movementHistory]);

  if (!part) {
    return (
      <div className="space-y-4" dir="rtl">
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <Package size={48} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-foreground">المنتج غير موجود</p>
          <Button onClick={() => smartBack(navigate, "/inventory")} variant="outline" className="mt-4 gap-2">
            <ArrowRight size={16} /> العودة للمخزون
          </Button>
        </div>
      </div>
    );
  }

  const isOut = part.stock <= 0;
  const isLow = part.stock > 0 && part.stock <= part.minStock;
  const stockColor = isOut ? "text-destructive" : isLow ? "text-warning" : "text-success";
  const stockLabel = isOut ? "نفد" : isLow ? "منخفض" : "متوفر";
  const stockBg = isOut ? "bg-destructive/15 border-destructive/30" : isLow ? "bg-warning/15 border-warning/30" : "bg-success/15 border-success/30";

  const margin = part.buyPrice > 0
    ? Math.round(((part.sellPrice - part.buyPrice) / part.buyPrice) * 100)
    : 0;

  const totals = {
    in: partMovements.filter((m) => m.type === "IN").reduce((s, m) => {
      const it = m.items.find((i) => i.partId === id);
      return s + (it?.qty || 0);
    }, 0),
    out: partMovements.filter((m) => m.type === "OUT").reduce((s, m) => {
      const it = m.items.find((i) => i.partId === id);
      return s + (it?.qty || 0);
    }, 0),
    transfer: partMovements.filter((m) => m.type === "TRANSFER").length,
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => smartBack(navigate, "/inventory")} className="gap-1 border-border">
            <ArrowRight size={14} /> العودة
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{part.name}</h1>
            <p className="text-xs text-muted-foreground font-mono">{part.partNumber} • {part.id}</p>
          </div>
        </div>
        <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold border ${stockBg} ${stockColor}`}>
          {stockLabel}
        </span>
      </div>

      {/* Top Info Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Product Info */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-card">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
              <Package size={26} className="text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-foreground mb-1">معلومات المنتج</h3>
              <div className="flex flex-wrap gap-1 mt-1">
                {part.brand && <span className="text-[10px] bg-info/10 text-info px-1.5 py-0.5 rounded"><Tag size={9} className="inline ml-0.5" />{part.brand}</span>}
                {part.category && <span className="text-[10px] bg-secondary text-muted-foreground px-1.5 py-0.5 rounded"><Boxes size={9} className="inline ml-0.5" />{part.category}</span>}
              </div>
            </div>
          </div>
          <dl className="space-y-2 text-xs">
            {part.barcode && <InfoRow icon={Barcode} label="الباركود" value={part.barcode} mono />}
            {part.supplier && <InfoRow icon={Tag} label="المورد" value={part.supplier} />}
            {part.location && <InfoRow icon={MapPin} label="الموقع" value={part.location} />}
            <InfoRow icon={AlertTriangle} label="حد التنبيه" value={`${part.minStock} قطعة`} />
          </dl>
        </div>

        {/* Stock & Pricing */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-card">
          <h3 className="text-sm font-semibold text-foreground mb-4">المخزون والأسعار</h3>
          <div className="grid grid-cols-2 gap-3 text-center">
            <Stat label="المخزون الحالي" value={part.stock.toString()} valueClass={stockColor} />
            <Stat label="مبيعات تراكمية" value={part.sold.toString()} />
            <Stat label="سعر الشراء" value={`${part.buyPrice} ر.ع`} />
            <Stat label="سعر البيع" value={`${part.sellPrice} ر.ع`} />
          </div>
          {margin > 0 && (
            <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-xs">
              <span className="text-muted-foreground">هامش الربح</span>
              <span className="text-success font-bold flex items-center gap-1">
                <TrendingUp size={12} /> +{margin}%
              </span>
            </div>
          )}
          <div className="mt-2 pt-2 border-t border-border text-xs flex items-center justify-between">
            <span className="text-muted-foreground">قيمة المخزون</span>
            <span className="font-bold text-foreground">{(part.stock * part.sellPrice).toLocaleString()} ر.ع</span>
          </div>
        </div>

        {/* Movement Totals */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-card">
          <h3 className="text-sm font-semibold text-foreground mb-4">إجمالي الحركات</h3>
          <div className="space-y-3">
            <MovementSummary type="IN" qty={totals.in} />
            <MovementSummary type="OUT" qty={totals.out} />
            <MovementSummary type="TRANSFER" qty={totals.transfer} isCount />
            <div className="pt-2 border-t border-border text-xs flex items-center justify-between">
              <span className="text-muted-foreground">صافي التغير</span>
              <span className={`font-bold ${totals.in - totals.out >= 0 ? "text-success" : "text-destructive"}`}>
                {totals.in - totals.out >= 0 ? "+" : ""}{totals.in - totals.out}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-card">
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <TrendingUp size={16} className="text-primary" /> مخطط الرصيد عبر الزمن
        </h3>
        {chartData.length <= 1 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">لا توجد حركات مسجلة لهذا المنتج بعد</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(42, 90%, 55%)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="hsl(42, 90%, 55%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 15%, 22%)" />
              <XAxis dataKey="date" tick={{ fill: "hsl(215, 15%, 55%)", fontSize: 11 }} />
              <YAxis tick={{ fill: "hsl(215, 15%, 55%)", fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  background: "hsl(222, 18%, 14%)",
                  border: "1px solid hsl(222, 15%, 22%)",
                  borderRadius: "8px",
                  color: "hsl(210, 20%, 92%)",
                  direction: "rtl",
                }}
                formatter={(val: any) => [`${val} قطعة`, "الرصيد"]}
              />
              <Area
                type="monotone"
                dataKey="balance"
                stroke="hsl(42, 90%, 55%)"
                strokeWidth={2}
                fill="url(#balGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* History Table */}
      <div className="bg-card border border-border rounded-xl shadow-card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <FileText size={16} className="text-primary" /> سجل الحركات ({partMovements.length})
          </h3>
          <Link to="/inventory/movements" className="text-xs text-primary hover:underline">
            كل الحركات ←
          </Link>
        </div>
        {partMovements.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground text-sm">لا توجد حركات مسجلة</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-right py-2.5 px-3 text-muted-foreground font-medium text-xs">التاريخ</th>
                  <th className="text-right py-2.5 px-3 text-muted-foreground font-medium text-xs">رقم الإذن</th>
                  <th className="text-right py-2.5 px-3 text-muted-foreground font-medium text-xs">النوع</th>
                  <th className="text-right py-2.5 px-3 text-muted-foreground font-medium text-xs">السبب</th>
                  <th className="text-right py-2.5 px-3 text-muted-foreground font-medium text-xs hidden md:table-cell">المرجع</th>
                  <th className="text-right py-2.5 px-3 text-muted-foreground font-medium text-xs">الكمية</th>
                  <th className="text-right py-2.5 px-3 text-muted-foreground font-medium text-xs">الرصيد قبل</th>
                  <th className="text-right py-2.5 px-3 text-muted-foreground font-medium text-xs">الرصيد بعد</th>
                </tr>
              </thead>
              <tbody>
                {/* صف رصيد البداية */}
                <tr className="border-b border-border/50 bg-secondary/20">
                  <td className="py-2 px-3 text-xs text-muted-foreground">-</td>
                  <td className="py-2 px-3 text-xs text-muted-foreground italic" colSpan={5}>رصيد افتتاحي</td>
                  <td className="py-2 px-3 text-xs"></td>
                  <td className="py-2 px-3 text-xs font-bold text-foreground">
                    {("startBalance" in movementHistory ? movementHistory.startBalance : 0)}
                  </td>
                </tr>
                {("rows" in movementHistory ? movementHistory.rows : []).map((row, idx) => (
                  <tr key={`${row.movement.id}-${idx}`} className="border-b border-border/50 hover:bg-secondary/20">
                    <td className="py-2.5 px-3 text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar size={11} /> {row.movement.date}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-xs text-primary">{row.movement.id}</td>
                    <td className="py-2.5 px-3"><TypeBadge type={row.movement.type} /></td>
                    <td className="py-2.5 px-3 text-xs text-foreground max-w-[200px] truncate">{row.movement.reason}</td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground hidden md:table-cell">{row.movement.reference || "-"}</td>
                    <td className="py-2.5 px-3 text-xs">
                      <span className={`font-bold ${row.delta > 0 ? "text-success" : row.delta < 0 ? "text-destructive" : "text-info"}`}>
                        {row.delta > 0 ? "+" : ""}{row.delta || row.item.qty}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground">{row.before}</td>
                    <td className="py-2.5 px-3 text-xs font-bold text-foreground">{row.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value, mono }: { icon: any; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Icon size={12} /> {label}
      </span>
      <span className={`text-foreground font-medium ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function Stat({ label, value, valueClass = "text-foreground" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="bg-secondary/40 rounded-lg p-2.5">
      <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
      <p className={`text-base font-bold ${valueClass}`}>{value}</p>
    </div>
  );
}

function MovementSummary({ type, qty, isCount }: { type: MovementType; qty: number; isCount?: boolean }) {
  const config = {
    IN: { label: "إدخال", color: "text-success", icon: ArrowDown, bg: "bg-success/10" },
    OUT: { label: "إخراج", color: "text-destructive", icon: ArrowUp, bg: "bg-destructive/10" },
    TRANSFER: { label: "تحويل", color: "text-info", icon: ArrowLeftRight, bg: "bg-info/10" },
  }[type];
  const Icon = config.icon;
  return (
    <div className={`flex items-center justify-between p-2 rounded-lg ${config.bg}`}>
      <span className={`flex items-center gap-2 text-xs font-medium ${config.color}`}>
        <Icon size={14} /> {config.label}
      </span>
      <span className={`text-sm font-bold ${config.color}`}>
        {qty} {isCount ? "حركة" : "قطعة"}
      </span>
    </div>
  );
}

function TypeBadge({ type }: { type: MovementType }) {
  const config = {
    IN: { label: "إدخال", color: "bg-success/15 text-success" },
    OUT: { label: "إخراج", color: "bg-destructive/15 text-destructive" },
    TRANSFER: { label: "تحويل", color: "bg-info/15 text-info" },
  }[type];
  return (
    <span className={`inline-flex text-[10px] px-2 py-0.5 rounded-full font-semibold ${config.color}`}>
      {config.label}
    </span>
  );
}
