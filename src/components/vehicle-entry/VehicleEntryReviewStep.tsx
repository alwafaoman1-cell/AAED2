import { useTranslation } from "react-i18next";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ENTRY_PHOTO_SLOTS, type VehicleEntryEditor } from "@/hooks/useVehicleEntryEditor";
import { Field, Section } from "./VehicleEntryFields";
import { SignaturePad } from "./VehicleEntryDrawingTools";
import "@/lib/i18n/vehicleIntakeWizard";

const PHOTO_LABELS = {
  front_view: "front", rear_view: "rear", right_side: "right", left_side: "left",
  plate_number: "plate", odometer: "odometer", vin: "vin", main_damage: "mainDamage",
} as const;
type EntryMedia = { id: string; file_name?: string; storage_path?: string; media_type?: string; category?: string; url?: string; public_url?: string };

export function VehicleEntryReviewStep({ editor }: { editor: VehicleEntryEditor }) {
  const { t, i18n } = useTranslation();
  const isEnglish = (i18n.resolvedLanguage || i18n.language || "ar").startsWith("en");
  const { form, patch, detail, pendingPhotos, photoInputRef, documentInputRef, stageEntryPhoto, activePhotoCategory,
    setActivePhotoCategory, removePendingPhoto, uploading, handleUpload, handleSignature, supplementalEntryMedia } = editor;
  const additionalPhotos = supplementalEntryMedia.filter((media: EntryMedia) => media.media_type === "image" && media.category !== "entry_document");
  const documents = supplementalEntryMedia.filter((media: EntryMedia) => media.media_type !== "image" || media.category === "entry_document");
  function mediaCategory(media: EntryMedia) {
    const photoLabel = PHOTO_LABELS[media.category as keyof typeof PHOTO_LABELS];
    if (photoLabel) return t(`vehicleIntakeWizard.${photoLabel}`);
    if (media.category === "entry_photo") return t("vehicleIntakeWizard.views.entryPhoto");
    if (media.category === "damage_photo") return t("vehicleIntakeWizard.views.damagePhoto");
    return media.category === "entry_document" ? t("vehicleIntakeWizard.views.mediaDocument") : t("vehicleIntakeWizard.views.otherCategory");
  }
  function attachment(media: EntryMedia) {
    const name = media.file_name || t("vehicleIntakeWizard.views.attachment");
    const url = media.url || media.public_url;
    return <div key={media.id} className="space-y-2 rounded-lg border border-border p-3 text-sm">
      <div className="truncate font-semibold">{name}</div>
      <div className="text-xs text-muted-foreground">{media.media_type === "image" ? t("vehicleIntakeWizard.views.mediaImage") : t("vehicleIntakeWizard.views.mediaDocument")} · {mediaCategory(media)}</div>
      {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="block text-primary underline underline-offset-2" aria-label={t("vehicleIntakeWizard.views.openAttachment", { name })}>
        {media.media_type === "image" ? <img src={url} alt={name} loading="lazy" className="h-28 w-full rounded object-contain" /> : t("vehicleIntakeWizard.views.openAttachment", { name })}
      </a> : <p className="text-xs text-muted-foreground">{t("vehicleIntakeWizard.views.unavailableAttachment")}</p>}
    </div>;
  }

  return <>
    <Section title={t("vehicleIntakeWizard.photos")} desc={t("vehicleIntakeWizard.photoHint")}>
      <input ref={photoInputRef} type="file" accept="image/*" className="hidden" aria-label={t("vehicleIntakeWizard.choosePhoto")} onChange={(e) => {
        stageEntryPhoto(activePhotoCategory, e.target.files?.[0]);
        e.currentTarget.value = "";
      }} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{ENTRY_PHOTO_SLOTS.map((slot) => {
        const pending = pendingPhotos.find((photo) => photo.category === slot.key);
        const existing = (detail.data?.vehicle_media || []).find((media: EntryMedia) => media.category === slot.key && media.media_type === "image");
        const previewUrl = pending?.previewUrl || existing?.url || existing?.public_url;
        const category = t(`vehicleIntakeWizard.${PHOTO_LABELS[slot.key]}`);
        return <div key={slot.key} className="relative overflow-hidden rounded-xl border border-dashed border-border bg-muted/30">
          <button type="button" aria-label={t(`vehicleIntakeWizard.views.${previewUrl ? "replacePhoto" : "addPhoto"}`, { category })} disabled={uploading}
            className="flex h-36 w-full flex-col items-center justify-center gap-2 p-2 hover:bg-muted/60 disabled:opacity-60" onClick={() => {
              setActivePhotoCategory(slot.key);
              setTimeout(() => photoInputRef.current?.click(), 0);
            }}>
            {previewUrl ? <img src={previewUrl} alt={category} className="absolute inset-0 h-full w-full object-cover" /> : <ImagePlus size={24} className="text-muted-foreground" aria-hidden="true" />}
            <span className={`relative z-10 rounded px-2 py-1 text-center text-xs font-semibold ${previewUrl ? "bg-background/90 text-foreground shadow" : ""}`}>{category}</span>
          </button>
          {pending && <Button type="button" variant="outline" size="icon" aria-label={t("vehicleIntakeWizard.views.removeStagedPhoto", { category })} disabled={uploading} className="absolute end-1 top-1 z-20 h-9 w-9 bg-card text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => removePendingPhoto(slot.key)}><Trash2 size={16} aria-hidden="true" /></Button>}
        </div>;
      })}</div>
      {pendingPhotos.length > 0 && <p role="status" className="text-xs font-medium text-info">{t("vehicleIntakeWizard.views.stagedPhotos", { count: pendingPhotos.length })}</p>}
      <h3 className="text-sm font-semibold">{t("vehicleIntakeWizard.views.additionalPhotos")}</h3>
      {additionalPhotos.length ? <div className="grid grid-cols-1 gap-2 md:grid-cols-3">{additionalPhotos.map(attachment)}</div> : <p className="text-sm text-muted-foreground">{t("vehicleIntakeWizard.views.emptyPhotos")}</p>}
    </Section>
    <Section title={t("vehicleIntakeWizard.documents")}>
      <input ref={documentInputRef} type="file" multiple accept="image/*,application/pdf" className="hidden" aria-label={t("vehicleIntakeWizard.uploadDocument")} onChange={(e) => void handleUpload(e.target.files, "document")} />
      <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" disabled={uploading || !form.id} onClick={() => documentInputRef.current?.click()}>{t("vehicleIntakeWizard.uploadDocument")}</Button>
        {!form.id && <span className="text-xs text-muted-foreground">{t("vehicleIntakeWizard.saveBeforeDocuments")}</span>}
        {uploading && <span role="status" className="text-xs text-muted-foreground">{t("vehicleIntakeWizard.views.uploading")}</span>}
      </div>
      {documents.length ? <div className="grid grid-cols-1 gap-2 md:grid-cols-3">{documents.map(attachment)}</div> : <p className="text-sm text-muted-foreground">{t("vehicleIntakeWizard.emptyDocuments")}</p>}
    </Section>
    <Section title={t("vehicleIntakeWizard.declaration")} desc={t("vehicleIntakeWizard.views.declarationHint")}>
      <div className={`grid grid-cols-1 gap-3 ${!isEnglish ? "lg:grid-cols-2" : ""}`}>
        {!isEnglish && <Field label={t("vehicleIntakeWizard.declarationArabic")}><Textarea dir="rtl" rows={7} value={form.declaration_ar} onChange={(e) => patch({ declaration_ar: e.target.value })} /></Field>}
        <Field label={t("vehicleIntakeWizard.declarationEnglish")}><Textarea dir="ltr" rows={7} value={form.declaration_en} onChange={(e) => patch({ declaration_en: e.target.value })} /></Field>
      </div>
    </Section>
    <Section title={t("vehicleIntakeWizard.signatures")} desc={t("vehicleIntakeWizard.paperSignature")}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SignaturePad title={t("vehicleIntakeWizard.customerSignature")} disabled={!form.id} onSave={(dataUrl) => void handleSignature("delivered_by", dataUrl)} />
        <SignaturePad title={t("vehicleIntakeWizard.receiverSignature")} disabled={!form.id} onSave={(dataUrl) => void handleSignature("receiver", dataUrl)} />
      </div>
    </Section>
  </>;
}
