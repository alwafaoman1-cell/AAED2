import { ArrowLeft, ArrowRight, Car } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function VehicleReturnContextBar() {
  const { pathname, search } = useLocation();
  const { i18n } = useTranslation();
  const vehicleId = new URLSearchParams(search).get("fromVehicle");
  if (!vehicleId || pathname.startsWith("/vehicles/")) return null;
  const english = i18n.language.toLowerCase().startsWith("en");
  const BackIcon = i18n.dir() === "rtl" ? ArrowRight : ArrowLeft;
  return (
    <div className="border-b border-primary/15 bg-primary/5 px-3 py-2 md:px-6 lg:px-8">
      <Link
        to={`/vehicles/${encodeURIComponent(vehicleId)}`}
        className="inline-flex items-center gap-2 text-xs font-semibold text-primary hover:underline md:text-sm"
      >
        <BackIcon className="h-4 w-4" />
        <Car className="h-4 w-4" />
        {english ? "Back to vehicle file" : "العودة إلى ملف المركبة"}
      </Link>
    </div>
  );
}
