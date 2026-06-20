import { useEffect, useState } from "react";
import { smartBack } from "@/lib/smartBack";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Plus, Pencil, Trash2, Save, Tags, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { expenseCategoriesStore, FinanceCategory } from "@/lib/financeSettingsStore";
import { expensesStore } from "@/lib/expensesStore";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";

const COLOR_OPTIONS = [
  "#ef4444", "#f59e0b", "#eab308", "#22c55e", "#06b6d4",
  "#3b82f6", "#8b5cf6", "#a855f7", "#ec4899", "#64748b",
];

export default function ExpenseCategoriesPage() {
  const navigate = useNavigate();
  const [, force] = useState(0);
  useEffect(() => {
    const u1 = expenseCategoriesStore.subscribe(() => force((n) => n + 1));
    const u2 = expensesStore.subscribe(() => force((n) => n + 1));
    return () => { u1(); u2(); };
  }, []);

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<FinanceCategory | null>(null);
  const [open, setOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(COLOR_OPTIONS[1]);
  const [active, setActive] = useState(true);

  const all = expenseCategoriesStore.getAll();
  const allExpenses = expensesStore.getAll();
  const filtered = all.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase())
  );

  const usageCount = (catId: string) =>
    allExpenses.filter((e) => e.categoryId === catId).length;

  const usageTotal = (catId: string) =>
    allExpenses
      .filter((e) => e.categoryId === catId)
      .reduce((s, e) => s + (Number(e.amount) || 0), 0);

  function startNew() {
    setEditing(null);
    setName(""); setDescription(""); setColor(COLOR_OPTIONS[1]); setActive(true);
    setOpen(true);
  }
  function startEdit(c: FinanceCategory) {
    setEditing(c);
    setName(c.name);
    setDescription(c.description || "");
    setColor(c.color || COLOR_OPTIONS[1]);
    setActive(c.active);
    setOpen(true);
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed) return toast.error("اكتب اسم التصنيف");
    const dup = all.find((c) => c.name === trimmed && c.id !== editing?.id);
    if (dup) return toast.error("اسم التصنيف موجود مسبقاً");

    if (editing) {
      expenseCategoriesStore.update(editing.id, {
        name: trimmed, description: description.trim() || undefined, color, active,
      });
      toast.success("تم تحديث التصنيف");
    } else {
      const id = `EC-${Date.now()}`;
      expenseCategoriesStore.add({
        id, name: trimmed, description: description.trim() || undefined,
        color, active, createdAt: new Date().toISOString(),
      });
      toast.success("تم إضافة التصنيف");
    }
    setOpen(false);
  }

  function confirmDelete() {
    if (!deleteId) return;
    const used = usageCount(deleteId);
    if (used > 0) {
      toast.error(`لا يمكن الحذف — التصنيف مستخدم في ${used} سند صرف. عطّله بدلاً من ذلك.`);
      setDeleteId(null);
      return;
    }
    expenseCategoriesStore.remove(deleteId);
    toast.success("تم الحذف");
    setDeleteId(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Tags className="text-primary" size={24} /> تصنيفات المصروفات
          </h1>
          <p className="text-sm text-muted-foreground">إدارة تصنيفات سندات الصرف (إضافة/تعديل/تعطيل)</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => smartBack(navigate, "/settings")}>
            <ArrowRight size={16} className="ml-1" /> رجوع
          </Button>
          <Button onClick={startNew} className="gap-2">
            <Plus size={16} /> تصنيف جديد
          </Button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-3 sm:p-4">
        <div className="relative max-w-sm mb-3">
          <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="بحث في التصنيفات..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9"
          />
        </div>

        {/* ===== Mobile: card list ===== */}
        <div className="md:hidden space-y-2">
          {filtered.length === 0 && (
            <div className="text-center text-muted-foreground py-8 text-sm">لا توجد تصنيفات</div>
          )}
          {filtered.map((c) => (
            <div key={c.id} className="border border-border rounded-lg p-3 bg-background/40">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span
                    className="w-3 h-3 rounded-full inline-block shrink-0"
                    style={{ background: c.color || "#888" }}
                  />
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{c.name}</div>
                    {c.description && (
                      <div className="text-[11px] text-muted-foreground truncate">{c.description}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(c)}>
                    <Pencil size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteId(c.id)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-between mt-2 text-[11px]">
                {c.active ? (
                  <span className="px-2 py-0.5 rounded bg-success/15 text-success">نشط</span>
                ) : (
                  <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground">معطّل</span>
                )}
                <div className="flex items-center gap-3 text-muted-foreground">
                  <span>السندات: <span className="font-mono text-foreground">{usageCount(c.id)}</span></span>
                  <span>الإجمالي: <span className="font-mono text-foreground">{usageTotal(c.id).toLocaleString()}</span></span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ===== Desktop: table ===== */}
        <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>الاسم</TableHead>
                <TableHead>الوصف</TableHead>
                <TableHead className="text-center">الحالة</TableHead>
                <TableHead className="text-center">عدد السندات</TableHead>
                <TableHead className="text-end">إجمالي الإنفاق</TableHead>
                <TableHead className="text-center w-32">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    لا توجد تصنيفات
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((c, i) => (
                <TableRow key={c.id}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full inline-block"
                        style={{ background: c.color || "#888" }}
                      />
                      <span className="font-medium">{c.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{c.description || "-"}</TableCell>
                  <TableCell className="text-center">
                    {c.active ? (
                      <span className="px-2 py-0.5 rounded text-[11px] bg-success/15 text-success">نشط</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[11px] bg-muted text-muted-foreground">معطّل</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center font-mono">{usageCount(c.id)}</TableCell>
                  <TableCell className="text-end font-mono">
                    {usageTotal(c.id).toLocaleString()} ر.ع
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => startEdit(c)} title="تعديل">
                        <Pencil size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteId(c.id)}
                        title="حذف"
                        className="text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>


      {/* Edit/Create Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل تصنيف" : "تصنيف مصروف جديد"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>اسم التصنيف *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثل: قطع غيار" />
            </div>
            <div className="space-y-1">
              <Label>الوصف</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
            <div className="space-y-1">
              <Label>اللون</Label>
              <div className="flex flex-wrap gap-2">
                {COLOR_OPTIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`w-8 h-8 rounded-full border-2 transition-transform ${
                      color === c ? "border-foreground scale-110" : "border-transparent"
                    }`}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between border-t pt-3">
              <Label>نشط</Label>
              <Switch checked={active} onCheckedChange={setActive} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={save} className="gap-2"><Save size={14} /> حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        onConfirm={confirmDelete}
        title="حذف التصنيف"
        description="هل أنت متأكد من حذف هذا التصنيف؟"
      />
    </div>
  );
}
