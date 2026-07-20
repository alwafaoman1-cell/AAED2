import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Car, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useVehicleAvatar, useDeleteVehicleAvatar, useUploadVehicleAvatar } from "@/hooks/useVehicleAvatar";

type VehicleAvatarSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<VehicleAvatarSize, string> = {
  sm: "h-10 w-10",
  md: "h-14 w-14",
  lg: "h-20 w-20",
};

const ICON_SIZE: Record<VehicleAvatarSize, number> = {
  sm: 18,
  md: 22,
  lg: 30,
};

interface VehicleAvatarProps {
  vehicleId?: string | null;
  tenantId?: string | null;
  claimId?: string | null;
  workOrderId?: string | null;
  imageUrl?: string | null;
  fallbackPhotos?: Array<string | null | undefined>;
  label?: string;
  size?: VehicleAvatarSize;
  className?: string;
  canEdit?: boolean;
}

export default function VehicleAvatar({
  vehicleId,
  tenantId,
  claimId,
  workOrderId,
  imageUrl,
  fallbackPhotos = [],
  label = "Vehicle",
  size = "md",
  className = "",
  canEdit = true,
}: VehicleAvatarProps) {
  const [failed, setFailed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { data: avatar, isLoading } = useVehicleAvatar(vehicleId);
  const uploadAvatar = useUploadVehicleAvatar();
  const deleteAvatar = useDeleteVehicleAvatar();

  const src = useMemo(
    () => [avatar?.url, imageUrl, ...fallbackPhotos].find((url) => !!String(url || "").trim()) || "",
    [avatar?.url, imageUrl, fallbackPhotos],
  );

  const activeSrc = src && !failed ? src : "";
  const editable = canEdit && !!vehicleId;
  const busy = uploadAvatar.isPending || deleteAvatar.isPending;

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const openDialog = () => setDialogOpen(true);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDialog();
    }
  };

  const handleFilePicked = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\//i.test(file.type || "")) return;
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return objectUrl;
    });
  };

  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file || !vehicleId) return;
    await uploadAvatar.mutateAsync({ vehicleId, tenantId, claimId, workOrderId, file });
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFailed(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDelete = async () => {
    if (!vehicleId) return;
    await deleteAvatar.mutateAsync(vehicleId);
    setFailed(false);
  };

  const avatarBody = activeSrc ? (
    <img
      src={activeSrc}
      alt={label}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`${SIZE_CLASS[size]} shrink-0 rounded-full border border-border bg-muted object-cover shadow-sm transition-transform duration-150 group-hover:scale-105 ${className}`}
    />
  ) : (
    <div
      className={`${SIZE_CLASS[size]} shrink-0 rounded-full border border-border bg-muted/70 text-muted-foreground shadow-sm flex items-center justify-center transition-transform duration-150 group-hover:scale-105 ${className}`}
    >
      {isLoading ? <Camera size={ICON_SIZE[size]} className="animate-pulse opacity-70" /> : <Car size={ICON_SIZE[size]} />}
    </div>
  );

  return (
    <>
      <HoverCard openDelay={180} closeDelay={80}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            aria-label={`View or change vehicle avatar: ${label}`}
            title="View or change vehicle avatar"
            onClick={openDialog}
            onKeyDown={onKeyDown}
            className="group relative inline-flex shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {avatarBody}
            {editable && (
              <span className="absolute -bottom-0.5 -left-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-background bg-primary text-primary-foreground shadow">
                <Camera size={11} />
              </span>
            )}
          </button>
        </HoverCardTrigger>
        <HoverCardContent side="top" align="center" className="z-[90] w-64 p-2">
          <div className="rounded-lg border bg-muted/30 p-2">
            {activeSrc ? (
              <img src={activeSrc} alt={label} className="max-h-52 w-full rounded-md object-contain" />
            ) : (
              <div className="flex h-40 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Car size={42} />
              </div>
            )}
            <div className="mt-2 truncate text-center text-xs text-muted-foreground">{label}</div>
          </div>
        </HoverCardContent>
      </HoverCard>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Vehicle avatar</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-center rounded-xl border bg-muted/30 p-3">
              {previewUrl || activeSrc ? (
                <img src={previewUrl || activeSrc} alt={label} className="max-h-72 w-full rounded-lg object-contain" />
              ) : (
                <div className="flex h-56 w-full flex-col items-center justify-center gap-2 rounded-lg bg-muted text-muted-foreground">
                  <Car size={54} />
                  <span className="text-sm">No vehicle avatar</span>
                </div>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => handleFilePicked(event.target.files?.[0])}
            />

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={!editable || busy}>
                <Upload size={14} className="me-1" />
                Choose image
              </Button>
              <Button onClick={handleUpload} disabled={!editable || busy || !previewUrl}>
                Save avatar
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={!editable || busy || !avatar?.id}>
                <Trash2 size={14} className="me-1" />
                Remove
              </Button>
            </div>

            {!editable && (
              <p className="text-xs text-muted-foreground">
                Viewing is allowed. Uploading requires vehicle edit permission and a saved vehicle record.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
