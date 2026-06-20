import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  useDroppable, type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft, Save, Eye, Plus, Trash2, GripVertical, Type, Image as ImageIcon,
  LayoutGrid, Table2, Calculator, QrCode, Stamp, Minus, FileText,
  Heading, Hash, AlignRight, AlignCenter, AlignLeft, Undo2, Redo2,
  ZoomIn, ZoomOut, Maximize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { usePrintTemplates, useTemplateMutations } from "@/hooks/usePrintTemplates";
import { renderTemplate } from "@/lib/printTemplates/renderer";
import { sampleDataFor } from "@/lib/printTemplates/sampleData";
import { getDocTypeMeta } from "@/lib/printTemplates/registry";
import { newBlockId, type BlockType, type DocType, type TemplateBlock, type TemplateSchema } from "@/lib/printTemplates/schema";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";

const COMPONENT_LIBRARY: Array<{ type: BlockType; label: string; icon: any; defaults?: Partial<TemplateBlock> }> = [
  { type: "header", label: "رأس الصفحة", icon: Heading },
  { type: "title", label: "عنوان", icon: Type, defaults: { props: { text: "عنوان", textEn: "TITLE" }, style: { textAlign: "center", fontSize: 16, fontWeight: "bold" } } },
  { type: "info_grid", label: "بطاقة بيانات", icon: LayoutGrid, defaults: { props: { columns: 2, fields: [{ label: "الحقل 1", bind: "field1" }, { label: "الحقل 2", bind: "field2" }] } } },
  { type: "items_table", label: "جدول البنود", icon: Table2, defaults: { props: { showRowNumbers: true, zebra: true } } },
  { type: "totals", label: "ملخص الإجماليات", icon: Calculator },
  { type: "estimation_badge", label: "شارة LUMP/UPL", icon: Hash, defaults: { props: { badgeText: "LUMP SUM" } } },
  { type: "qr_zatca", label: "رمز ZATCA", icon: QrCode },
  { type: "stamp", label: "ختم وتوقيع", icon: Stamp },
  { type: "text", label: "نص حر", icon: Type, defaults: { props: { text: "اكتب هنا..." } } },
  { type: "image", label: "صورة", icon: ImageIcon },
  { type: "divider", label: "خط فاصل", icon: Minus },
  { type: "spacer", label: "مسافة", icon: Minus, defaults: { props: { size: 4 } } },
  { type: "footer", label: "تذييل", icon: FileText, defaults: { props: { text: "شكراً لتعاملكم معنا" } } },
];

const BLOCK_LABELS: Record<BlockType, string> = Object.fromEntries(
  COMPONENT_LIBRARY.map((c) => [c.type, c.label])
) as any;

export default function PrintTemplateEditor() {
  const { docType, id } = useParams<{ docType: DocType; id: string }>();
  const navigate = useNavigate();
  const meta = getDocTypeMeta(docType as DocType);

  const { templates, isLoading } = usePrintTemplates(docType as DocType);
  const { update } = useTemplateMutations();
  const tpl = templates.find((t) => t.id === id);

  const [schema, setSchema] = useState<TemplateSchema | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<TemplateSchema[]>([]);
  const [future, setFuture] = useState<TemplateSchema[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(0.85);
  const [activeZone, setActiveZone] = useState<"header" | "body" | "footer">("body");
  const previewWrapRef = useRef<HTMLDivElement>(null);

  // Calculate zoom that fits the preview into the available area
  const computeFitZoom = () => {
    const el = previewWrapRef.current;
    if (!el) return 0.85;
    // A4 = 794 x 1123 px @ 96dpi. Allow some padding (32px each side).
    const availW = el.clientWidth - 32;
    const availH = el.clientHeight - 32;
    const fit = Math.min(availW / 794, availH / 1123);
    return Math.max(0.3, Math.min(1.5, Number(fit.toFixed(2))));
  };

  const fitToScreen = () => setPreviewZoom(computeFitZoom());

  // Fit on mount + on window resize
  useEffect(() => {
    const onResize = () => setPreviewZoom(computeFitZoom());
    const t = setTimeout(onResize, 50);
    window.addEventListener("resize", onResize);
    return () => { clearTimeout(t); window.removeEventListener("resize", onResize); };
  }, []);

  useEffect(() => {
    if (tpl && !schema) {
      setSchema(tpl.schema);
      setName(tpl.name);
      setDescription(tpl.description || "");
    }
  }, [tpl, schema]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const sample = useMemo(() => sampleDataFor((docType as DocType) || "tax_invoice"), [docType]);
  const previewHtml = useMemo(
    () => (schema ? renderTemplate(schema, sample, name || meta.nameAr) : ""),
    [schema, sample, name, meta]
  );

  const updateSchema = (next: TemplateSchema) => {
    setHistory((h) => [...h, schema!]);
    setFuture([]);
    setSchema(next);
    setDirty(true);
  };

  const undo = () => {
    if (!history.length) return;
    const prev = history[history.length - 1];
    setFuture((f) => [schema!, ...f]);
    setHistory((h) => h.slice(0, -1));
    setSchema(prev);
    setDirty(true);
  };
  const redo = () => {
    if (!future.length) return;
    const next = future[0];
    setHistory((h) => [...h, schema!]);
    setFuture((f) => f.slice(1));
    setSchema(next);
    setDirty(true);
  };

  const addBlock = (type: BlockType, zone?: "header" | "body" | "footer") => {
    if (!schema) return;
    const lib = COMPONENT_LIBRARY.find((c) => c.type === type);
    const newBlock: TemplateBlock = {
      id: newBlockId(),
      type,
      zone: zone || activeZone,
      props: lib?.defaults?.props || {},
      style: lib?.defaults?.style || {},
    };
    updateSchema({ ...schema, blocks: [...schema.blocks, newBlock] });
    setSelectedId(newBlock.id);
  };

  const deleteBlock = (bid: string) => {
    if (!schema) return;
    updateSchema({ ...schema, blocks: schema.blocks.filter((b) => b.id !== bid) });
    if (selectedId === bid) setSelectedId(null);
  };

  const updateBlock = (bid: string, patch: Partial<TemplateBlock>) => {
    if (!schema) return;
    updateSchema({
      ...schema,
      blocks: schema.blocks.map((b) =>
        b.id === bid ? { ...b, ...patch, props: { ...b.props, ...(patch.props || {}) }, style: { ...b.style, ...(patch.style || {}) } } : b
      ),
    });
  };

  const updatePage = (patch: Partial<TemplateSchema["page"]>) => {
    if (!schema) return;
    updateSchema({ ...schema, page: { ...schema.page, ...patch } });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id || !schema) return;
    const overIdStr = String(over.id);
    // If dropped on a zone container, move block to that zone (append at end)
    if (overIdStr.startsWith("zone:")) {
      const targetZone = overIdStr.slice(5) as "header" | "body" | "footer";
      const blocks = schema.blocks.map((b) =>
        b.id === active.id ? { ...b, zone: targetZone } : b
      );
      updateSchema({ ...schema, blocks });
      return;
    }
    const oldIdx = schema.blocks.findIndex((b) => b.id === active.id);
    const newIdx = schema.blocks.findIndex((b) => b.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    // Inherit target block's zone
    const targetZone = schema.blocks[newIdx].zone || "body";
    const moved = arrayMove(schema.blocks, oldIdx, newIdx).map((b) =>
      b.id === active.id ? { ...b, zone: targetZone } : b
    );
    updateSchema({ ...schema, blocks: moved });
  };

  const handleSave = async () => {
    if (!tpl || !schema) return;
    try {
      await update.mutateAsync({ id: tpl.id, patch: { schema, name, description } as any });
      toast.success("تم حفظ القالب وتطبيقه فوراً");
      setDirty(false);
    } catch (e: any) {
      toast.error(e?.message || "فشل الحفظ");
    }
  };

  const selected = schema?.blocks.find((b) => b.id === selectedId) || null;

  if (isLoading || !schema) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">جاري التحميل...</div>;
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-card flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/settings/print-templates/${docType}`)}>
            <ArrowLeft className="rtl:rotate-180" size={18} />
          </Button>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${meta.color}18`, color: meta.color }}>
            <meta.icon size={16} />
          </div>
          <div className="min-w-0">
            <Input
              value={name}
              onChange={(e) => { setName(e.target.value); setDirty(true); }}
              className="border-0 bg-transparent h-7 text-sm font-bold px-1 focus-visible:ring-1"
              placeholder="اسم القالب"
            />
            <div className="text-[10px] text-muted-foreground px-1">{meta.nameAr}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {dirty && <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/40 text-amber-500">● غير محفوظ</Badge>}
          <Button variant="ghost" size="icon" onClick={undo} disabled={!history.length} title="تراجع">
            <Undo2 size={16} />
          </Button>
          <Button variant="ghost" size="icon" onClick={redo} disabled={!future.length} title="إعادة">
            <Redo2 size={16} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)} className="gap-1.5">
            <Eye size={14} /> معاينة كاملة
          </Button>
          <Button size="sm" onClick={handleSave} disabled={update.isPending} className="gap-1.5">
            <Save size={14} /> {update.isPending ? "جارٍ الحفظ..." : "حفظ وتطبيق"}
          </Button>
        </div>
      </div>

      {/* 4-Column Layout — components | structure | preview | properties */}
      <div className="flex-1 grid grid-cols-[220px_320px_1fr_300px] overflow-hidden">
        {/* LEFT — Components */}
        <aside className="border-l border-border bg-card overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-border flex-shrink-0">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">المكونات</h3>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">انقر لإضافة عنصر للمنطقة النشطة</p>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 grid grid-cols-2 gap-1.5">
              {COMPONENT_LIBRARY.map((c) => {
                const Icon = c.icon;
                return (
                  <button
                    key={c.type}
                    onClick={() => addBlock(c.type)}
                    className="flex flex-col items-center gap-1.5 p-2.5 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition text-center"
                  >
                    <Icon size={18} className="text-muted-foreground" />
                    <span className="text-[10px] font-medium leading-tight">{c.label}</span>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </aside>

        {/* STRUCTURE — 3 zones drag-drop */}
        <section className="border-l border-border bg-muted/30 overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-border bg-card/50 flex items-center justify-between text-xs flex-shrink-0">
            <span className="font-bold text-muted-foreground uppercase tracking-wide text-[11px]">بنية القالب</span>
            <Badge variant="outline" className="text-[9px] h-4">{schema.blocks.length} عنصر</Badge>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-3">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                {(["header", "body", "footer"] as const).map((zone) => {
                  const zoneBlocks = schema.blocks.filter((b) => (b.zone || "body") === zone);
                  const zoneLabels = { header: "🔝 الرأس", body: "📄 المتن", footer: "⬇️ التذييل" };
                  const zoneColors = { header: "border-blue-500/40 bg-blue-500/5", body: "border-emerald-500/40 bg-emerald-500/5", footer: "border-amber-500/40 bg-amber-500/5" };
                  const isActive = activeZone === zone;
                  return (
                    <DropZone key={zone} zone={zone} active={isActive} onClick={() => setActiveZone(zone)} className={zoneColors[zone]}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-bold">{zoneLabels[zone]}</span>
                        <Badge variant="outline" className="text-[9px] h-4">{zoneBlocks.length}</Badge>
                      </div>
                      <SortableContext items={zoneBlocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                        <div className="space-y-1.5 min-h-[50px]">
                          {zoneBlocks.map((b) => (
                            <SortableBlock
                              key={b.id}
                              block={b}
                              selected={selectedId === b.id}
                              onSelect={() => { setSelectedId(b.id); setActiveZone(zone); }}
                              onDelete={() => deleteBlock(b.id)}
                            />
                          ))}
                          {zoneBlocks.length === 0 && (
                            <div className="text-center text-muted-foreground/60 py-3 text-[10px] italic">
                              {isActive ? "أضف عنصراً من اليسار" : "اضغط هنا لتفعيل المنطقة"}
                            </div>
                          )}
                        </div>
                      </SortableContext>
                    </DropZone>
                  );
                })}
              </DndContext>
            </div>
          </ScrollArea>
        </section>

        {/* CENTER — Live Preview (large) */}
        <main className="bg-muted/40 overflow-hidden flex flex-col">
          <div className="px-4 py-2 border-b border-border bg-card/50 flex items-center justify-between text-xs flex-shrink-0">
            <span className="text-muted-foreground flex items-center gap-1.5"><Eye size={12} /> معاينة فورية — A4</span>
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPreviewZoom((z) => Math.max(0.3, +(z - 0.1).toFixed(2)))} title="تصغير"><ZoomOut size={13} /></Button>
              <input
                type="range"
                min={30}
                max={150}
                step={5}
                value={Math.round(previewZoom * 100)}
                onChange={(e) => setPreviewZoom(Number(e.target.value) / 100)}
                className="w-28 h-1 accent-primary cursor-pointer"
              />
              <span className="font-mono text-[10px] w-10 text-center">{Math.round(previewZoom * 100)}%</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPreviewZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(2)))} title="تكبير"><ZoomIn size={13} /></Button>
              <Button variant="outline" size="sm" className="h-7 text-[10px] px-2.5 gap-1" onClick={fitToScreen} title="مناسب للشاشة">
                <Maximize2 size={11} /> مناسب للشاشة
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-[10px] px-2" onClick={() => setPreviewZoom(1)} title="حجم حقيقي 100%">100%</Button>
            </div>
          </div>
          <div ref={previewWrapRef} className="flex-1 overflow-auto p-4 flex items-start justify-center">
            <div
              className="bg-white border border-border rounded-md shadow-2xl flex-shrink-0"
              style={{
                width: `${Math.round(794 * previewZoom)}px`,
                height: `${Math.round(1123 * previewZoom)}px`,
                overflow: "hidden",
              }}
            >
              <iframe
                srcDoc={previewHtml}
                title="preview"
                style={{
                  width: "794px",
                  height: "1123px",
                  border: 0,
                  transform: `scale(${previewZoom})`,
                  transformOrigin: "0 0",
                  display: "block",
                  backgroundColor: "#fff",
                  // Crisper rendering when scaled
                  imageRendering: previewZoom < 1 ? "auto" : "crisp-edges",
                  WebkitFontSmoothing: "antialiased",
                  backfaceVisibility: "hidden",
                } as any}
                sandbox="allow-same-origin"
              />
            </div>
          </div>
        </main>

        {/* RIGHT — Properties */}
        <aside className="border-r border-border bg-card overflow-hidden flex flex-col">
          <Tabs defaultValue={selected ? "block" : "page"} value={selected ? "block" : "page"} className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="grid grid-cols-2 m-2 flex-shrink-0">
              <TabsTrigger value="block" disabled={!selected} className="text-xs">
                خصائص العنصر
              </TabsTrigger>
              <TabsTrigger value="page" className="text-xs">
                إعدادات الصفحة
              </TabsTrigger>
            </TabsList>
            <ScrollArea className="flex-1">
              <TabsContent value="block" className="p-3 m-0">
                {selected ? (
                  <BlockPropertiesPanel block={selected} onChange={(p) => updateBlock(selected.id, p)} />
                ) : (
                  <div className="text-xs text-muted-foreground text-center py-8">اختر عنصراً للتعديل</div>
                )}
              </TabsContent>
              <TabsContent value="page" className="p-3 m-0">
                <PageSettingsPanel schema={schema} onChange={updatePage} />
              </TabsContent>
            </ScrollArea>
          </Tabs>
        </aside>
      </div>

      <PdfPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        htmlContent={previewHtml}
        title={`معاينة: ${name}`}
        fileName={name}
      />
    </div>
  );
}

/* ===== Drop Zone Container ===== */
function DropZone({ zone, active, onClick, className, children }: {
  zone: "header" | "body" | "footer";
  active: boolean;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `zone:${zone}` });
  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      className={`rounded-lg border-2 border-dashed p-3 transition cursor-pointer ${className || ""} ${
        active ? "ring-2 ring-primary/50" : ""
      } ${isOver ? "ring-2 ring-primary bg-primary/10" : ""}`}
    >
      {children}
    </div>
  );
}

function SortableBlock({ block, selected, onSelect, onDelete }: {
  block: TemplateBlock; selected: boolean; onSelect: () => void; onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const hidden = block.style?.visible === false;
  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={`group flex items-center gap-2 p-2.5 rounded-md border cursor-pointer transition ${
        selected ? "border-primary bg-primary/5" : "border-border bg-background hover:border-primary/40"
      } ${hidden ? "opacity-50" : ""}`}
    >
      <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground hover:text-foreground" onClick={(e) => e.stopPropagation()}>
        <GripVertical size={14} />
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold flex items-center gap-1.5">
          {BLOCK_LABELS[block.type] || block.type}
          {hidden && <Badge variant="outline" className="text-[9px] h-4 px-1">مخفي</Badge>}
        </div>
        {(block.props as any)?.text && (
          <div className="text-[10px] text-muted-foreground truncate">{(block.props as any).text}</div>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive hover:bg-destructive/10"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
      >
        <Trash2 size={12} />
      </Button>
    </div>
  );
}

/* ===== Block Properties Panel ===== */
function BlockPropertiesPanel({ block, onChange }: { block: TemplateBlock; onChange: (patch: Partial<TemplateBlock>) => void }) {
  const setStyle = (k: string, v: any) => onChange({ style: { [k]: v } as any });
  const setProps = (k: string, v: any) => onChange({ props: { [k]: v } as any });
  const s = block.style || {};
  const p: any = block.props || {};

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[11px] font-bold uppercase text-muted-foreground mb-2">{BLOCK_LABELS[block.type]}</div>
      </div>

      {/* Visibility */}
      <Field label="مرئي">
        <Switch checked={s.visible !== false} onCheckedChange={(v) => setStyle("visible", v)} />
      </Field>

      {/* Text props for blocks that support it */}
      {["title", "text", "footer", "header"].includes(block.type) && (
        <>
          <Field label="النص العربي">
            <Input value={p.text || ""} onChange={(e) => setProps("text", e.target.value)} className="h-8 text-xs" />
          </Field>
          <Field label="النص الإنجليزي">
            <Input value={p.textEn || ""} onChange={(e) => setProps("textEn", e.target.value)} className="h-8 text-xs" dir="ltr" />
          </Field>
        </>
      )}

      {/* Estimation badge */}
      {block.type === "estimation_badge" && (
        <>
          <Field label="نص الشارة">
            <Select value={p.badgeText || "LUMP SUM"} onValueChange={(v) => setProps("badgeText", v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="LUMP SUM">LUMP SUM</SelectItem>
                <SelectItem value="UPL">UPL</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="لون الشارة">
            <Input type="color" value={p.badgeColor || "#dc2626"} onChange={(e) => setProps("badgeColor", e.target.value)} className="h-8 w-full" />
          </Field>
        </>
      )}

      {/* Items table options */}
      {block.type === "items_table" && (
        <>
          <Field label="ترقيم الصفوف"><Switch checked={!!p.showRowNumbers} onCheckedChange={(v) => setProps("showRowNumbers", v)} /></Field>
          <Field label="صفوف بألوان متناوبة"><Switch checked={!!p.zebra} onCheckedChange={(v) => setProps("zebra", v)} /></Field>
        </>
      )}

      {/* Info grid columns */}
      {block.type === "info_grid" && (
        <Field label="عدد الأعمدة">
          <Select value={String(p.columns || 2)} onValueChange={(v) => setProps("columns", Number(v))}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      )}

      {/* QR */}
      {block.type === "qr_zatca" && (
        <Field label="حجم الرمز (mm)">
          <Input type="number" min={15} max={50} value={p.qrSize ?? 28} onChange={(e) => setProps("qrSize", Number(e.target.value))} className="h-8 text-xs" />
        </Field>
      )}

      {/* Spacer */}
      {block.type === "spacer" && (
        <Field label="الارتفاع (mm)">
          <Input type="number" min={1} max={100} value={p.size ?? 4} onChange={(e) => setProps("size", Number(e.target.value))} className="h-8 text-xs" />
        </Field>
      )}

      {/* Image */}
      {block.type === "image" && (
        <>
          <Field label="رابط الصورة">
            <Input value={p.src || ""} onChange={(e) => setProps("src", e.target.value)} className="h-8 text-xs" dir="ltr" placeholder="https://..." />
          </Field>
          <Field label="العرض (mm)">
            <Input type="number" value={p.width ?? 60} onChange={(e) => setProps("width", Number(e.target.value))} className="h-8 text-xs" />
          </Field>
        </>
      )}

      <div className="border-t border-border pt-3 space-y-3">
        <div className="text-[11px] font-bold uppercase text-muted-foreground">التنسيق</div>

        <Field label="حجم الخط (pt)">
          <Input type="number" min={6} max={36} value={s.fontSize ?? ""} onChange={(e) => setStyle("fontSize", Number(e.target.value) || undefined)} className="h-8 text-xs" placeholder="افتراضي" />
        </Field>

        <Field label="وزن الخط">
          <Select value={String(s.fontWeight || "normal")} onValueChange={(v) => setStyle("fontWeight", v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="normal">عادي</SelectItem>
              <SelectItem value="600">شبه غامق</SelectItem>
              <SelectItem value="bold">غامق</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="اللون">
          <div className="flex gap-1.5">
            <Input type="color" value={s.color || "#1f2937"} onChange={(e) => setStyle("color", e.target.value)} className="h-8 w-12 p-1" />
            <Input value={s.color || ""} onChange={(e) => setStyle("color", e.target.value)} className="h-8 text-xs" placeholder="#1f2937" />
          </div>
        </Field>

        <Field label="لون الخلفية">
          <div className="flex gap-1.5">
            <Input type="color" value={s.backgroundColor || "#ffffff"} onChange={(e) => setStyle("backgroundColor", e.target.value)} className="h-8 w-12 p-1" />
            <Input value={s.backgroundColor || ""} onChange={(e) => setStyle("backgroundColor", e.target.value)} className="h-8 text-xs" placeholder="شفاف" />
          </div>
        </Field>

        <Field label="المحاذاة">
          <div className="flex gap-1">
            {[
              { v: "right", icon: AlignRight },
              { v: "center", icon: AlignCenter },
              { v: "left", icon: AlignLeft },
            ].map(({ v, icon: I }) => (
              <Button key={v} type="button" variant={s.textAlign === v ? "default" : "outline"} size="sm" className="flex-1 h-8" onClick={() => setStyle("textAlign", v)}>
                <I size={14} />
              </Button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="هامش علوي (mm)">
            <Input type="number" value={s.marginTop ?? ""} onChange={(e) => setStyle("marginTop", Number(e.target.value) || undefined)} className="h-8 text-xs" />
          </Field>
          <Field label="هامش سفلي (mm)">
            <Input type="number" value={s.marginBottom ?? ""} onChange={(e) => setStyle("marginBottom", Number(e.target.value) || undefined)} className="h-8 text-xs" />
          </Field>
        </div>
      </div>
    </div>
  );
}

/* ===== Page Settings Panel ===== */
function PageSettingsPanel({ schema, onChange }: { schema: TemplateSchema; onChange: (p: Partial<TemplateSchema["page"]>) => void }) {
  const p = schema.page;
  return (
    <div className="space-y-4">
      <div className="text-[11px] font-bold uppercase text-muted-foreground">إعدادات الصفحة</div>
      <Field label="حجم الصفحة">
        <Select value={p.size} onValueChange={(v: any) => onChange({ size: v })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="A4">A4 (210×297mm)</SelectItem>
            <SelectItem value="A5">A5 (148×210mm)</SelectItem>
            <SelectItem value="Letter">Letter</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field label="الاتجاه">
        <Select value={p.orientation} onValueChange={(v: any) => onChange({ orientation: v })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="portrait">عمودي</SelectItem>
            <SelectItem value="landscape">أفقي</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field label="من اليمين لليسار (RTL)">
        <Switch checked={p.rtl} onCheckedChange={(v) => onChange({ rtl: v })} />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="هامش علوي"><Input type="number" value={p.marginTop} onChange={(e) => onChange({ marginTop: Number(e.target.value) })} className="h-8 text-xs" /></Field>
        <Field label="هامش سفلي"><Input type="number" value={p.marginBottom} onChange={(e) => onChange({ marginBottom: Number(e.target.value) })} className="h-8 text-xs" /></Field>
        <Field label="هامش يمين"><Input type="number" value={p.marginRight} onChange={(e) => onChange({ marginRight: Number(e.target.value) })} className="h-8 text-xs" /></Field>
        <Field label="هامش يسار"><Input type="number" value={p.marginLeft} onChange={(e) => onChange({ marginLeft: Number(e.target.value) })} className="h-8 text-xs" /></Field>
      </div>

      <Field label="عائلة الخط">
        <Select value={p.baseFontFamily} onValueChange={(v: any) => onChange({ baseFontFamily: v })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Cairo">Cairo</SelectItem>
            <SelectItem value="Tajawal">Tajawal</SelectItem>
            <SelectItem value="Amiri">Amiri</SelectItem>
            <SelectItem value="Inter">Inter</SelectItem>
            <SelectItem value="Arial">Arial</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field label="حجم الخط الأساسي (pt)">
        <Input type="number" min={7} max={14} value={p.baseFontSize} onChange={(e) => onChange({ baseFontSize: Number(e.target.value) })} className="h-8 text-xs" />
      </Field>

      <Field label="اللون الأساسي">
        <div className="flex gap-1.5">
          <Input type="color" value={p.primaryColor} onChange={(e) => onChange({ primaryColor: e.target.value })} className="h-8 w-12 p-1" />
          <Input value={p.primaryColor} onChange={(e) => onChange({ primaryColor: e.target.value })} className="h-8 text-xs" />
        </div>
      </Field>

      <Field label="نص العلامة المائية">
        <Input value={p.watermarkText || ""} onChange={(e) => onChange({ watermarkText: e.target.value })} className="h-8 text-xs" placeholder="فارغ = بدون" />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">{label}</Label>
      {children}
    </div>
  );
}
