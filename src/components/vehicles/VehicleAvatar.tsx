import { useMemo, useState } from "react";
import { Car } from "lucide-react";

type VehicleAvatarSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<VehicleAvatarSize, string> = {
  sm: "h-10 w-10",
  md: "h-14 w-14",
  lg: "h-20 w-20",
};

interface VehicleAvatarProps {
  imageUrl?: string | null;
  fallbackPhotos?: Array<string | null | undefined>;
  label?: string;
  size?: VehicleAvatarSize;
  className?: string;
}

export default function VehicleAvatar({
  imageUrl,
  fallbackPhotos = [],
  label = "Vehicle",
  size = "md",
  className = "",
}: VehicleAvatarProps) {
  const [failed, setFailed] = useState(false);
  const src = useMemo(
    () => [imageUrl, ...fallbackPhotos].find((url) => !!String(url || "").trim()) || "",
    [imageUrl, fallbackPhotos],
  );

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={label}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={`${SIZE_CLASS[size]} shrink-0 rounded-full border border-border bg-muted object-cover shadow-sm ${className}`}
      />
    );
  }

  return (
    <div
      aria-label={label}
      className={`${SIZE_CLASS[size]} shrink-0 rounded-full border border-border bg-muted/70 text-muted-foreground shadow-sm flex items-center justify-center ${className}`}
    >
      <Car size={size === "lg" ? 30 : size === "md" ? 22 : 18} />
    </div>
  );
}
