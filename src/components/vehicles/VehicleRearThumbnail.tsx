import { useEffect, useState } from "react";
import { Car } from "lucide-react";

interface VehicleRearThumbnailProps {
  url?: string | null;
  alt: string;
}

/** A small, read-only view of the entry's existing rear photo. */
export function VehicleRearThumbnail({ url, alt }: VehicleRearThumbnailProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const className = "h-11 w-11 shrink-0 rounded-md border border-border bg-muted object-cover";

  return url && !failed ? (
    <img src={url} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className={className} />
  ) : (
    <span role="img" aria-label={alt} className={`${className} inline-flex items-center justify-center text-muted-foreground`}>
      <Car size={19} aria-hidden="true" />
    </span>
  );
}
