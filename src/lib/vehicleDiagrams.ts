// Vehicle blueprints used as background for damage annotation.
// Single sedan blueprint — pickup removed per request.

import sedanBlueprint from "@/assets/vehicle-sedan-blueprint.jpg";

export const VEHICLE_TEMPLATES = [
  { id: "sedan-blueprint", label: "Sedan (full blueprint)", labelEn: "Sedan (full blueprint)", src: sedanBlueprint },
] as const;

export const DEFAULT_VEHICLE_TEMPLATE_SRC = VEHICLE_TEMPLATES[0].src;
