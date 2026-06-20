import { useEffect, useState } from "react";
import { Trash2, RotateCcw, Trash, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ENTITY_LABELS,
  emptyTrash,
  getTrash,
  permanentlyDelete,
  restore,
  subscribeTrash,
  type EntityType,
  type TrashItem,
} from "@/lib/trashStore";
import { canAccessTrash } from "@/lib/permissions";
import { useTrashRestoreHandlers } from "@/hooks/useTrashRestoreHandlers";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import { toast } from "sonner";

export default function TrashPage() {
  useTrashRestoreHandlers();
  const [items, setItems] = useState<TrashItem[]>(getTrash());
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<EntityType | "all">("all");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);

  useEffect(() => {
    return subscribeTrash(() => setItems([...getTrash()]));
  }, []);

  if (!canAccessTrash()) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center">
        <p className="text-foreground font-semibold">صلاحيات غير كافية</p>
        <p className="text-sm text-muted-foreground mt-1">سلة المهملات متاحة للمدير فقط (Admin only)</p>
      </div>
    );
  }

  const filtered = items.filter((it) => {
    if (typeFilter !== "all" && it.type !== typeFilter) return false;
    if (!search) return true;
    return (
      it.label.toLowerCase().includes(search.toLowerCase()) ||
      it.entityId.toLowerCase().includes(search.toLowerCase())
    );
  });

  function handleRestore(it: TrashItem) {
    if (restore(it.trashId)) {
      toast.success(`تم استرجاع: ${it.label}`);
    } else {
      toast.error("لم يتم العثور على معالج الاسترجاع");
    }
  }

  function handlePermanent(trashId: string) {
    permanentlyDelete(trashId);
    setDeleteId(null);
    toast.success("تم الحذف نهائياً");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <Link to="/settings" className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 mb-1">
            <ArrowLeft size={12} /> العودة للإعدادات
          </Link>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Trash2 size={22} className="text-destructive" /> سلة المهملات
          </h1>
          <p className="text-sm text-muted-foreground">
            العناصر المحذوفة — يمكنك استرجاعها أو حذفها نهائياً ({items.length})
          </p>
        </div>
        {items.length > 0 && (
          <Button
            variant="destructive"
            onClick={() => setShowEmpty(true)}
            className="gap-2"
          >
            <Trash size={16} /> إفراغ السلة
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          placeholder="بحث في السلة..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-card border-border max-w-md"
        />
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as EntityType | "all")}>
          <SelectTrigger className="w-[220px] bg-card border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">كل الأنواع</SelectItem>
            {Object.entries(ENTITY_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Trash2 size={40} className="mx-auto mb-3 opacity-30" />
            <p>السلة فارغة</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">النوع</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">المعرف</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">الوصف</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">تاريخ الحذف</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((it) => (
                  <tr key={it.trashId} className="border-b border-border/50 hover:bg-secondary/20">
                    <td className="py-3 px-4">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-foreground">
                        {ENTITY_LABELS[it.type]}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-primary">{it.entityId}</td>
                    <td className="py-3 px-4 text-foreground">{it.label}</td>
                    <td className="py-3 px-4 text-muted-foreground text-xs">
                      {new Date(it.deletedAt).toLocaleString("ar")}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-border gap-1 h-7 text-xs"
                          onClick={() => handleRestore(it)}
                          title="استرجاع"
                        >
                          <RotateCcw size={12} /> استرجاع
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setDeleteId(it.trashId)}
                          title="حذف نهائي"
                        >
                          <Trash size={14} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDeleteDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        onConfirm={() => deleteId && handlePermanent(deleteId)}
        title="حذف نهائي"
        description="سيتم حذف العنصر بشكل نهائي ولا يمكن استرجاعه. هل تريد المتابعة؟"
        confirmLabel="حذف نهائياً"
      />
      <ConfirmDeleteDialog
        open={showEmpty}
        onOpenChange={setShowEmpty}
        onConfirm={() => {
          emptyTrash();
          setShowEmpty(false);
          toast.success("تم إفراغ السلة");
        }}
        title="إفراغ سلة المهملات"
        description={`سيتم حذف ${items.length} عنصر بشكل نهائي. هذا الإجراء لا يمكن التراجع عنه.`}
        confirmLabel="إفراغ نهائياً"
      />
    </div>
  );
}
