export interface CustomerPortalInvitation {
  customerName?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleYear?: string | number | null;
  url?: string | null;
}

/** Deliberate allowlist: plate/VIN/order/claim/financial/work-item fields are never accepted. */
export function buildCustomerPortalInvitation(input: CustomerPortalInvitation, language: "ar" | "en"): string {
  const vehicle = [input.vehicleMake, input.vehicleModel, input.vehicleYear].filter(Boolean).join(" ");
  const lines = language === "en"
    ? [`Hello ${input.customerName || ""},`, vehicle ? `Your vehicle: ${vehicle}.` : "Your customer portal is ready."]
    : [`مرحبًا ${input.customerName || ""}،`, vehicle ? `مركبتك: ${vehicle}.` : "بوابة العميل جاهزة للمراجعة."];
  if (input.url) lines.push(language === "en" ? "Open your single customer portal:" : "افتح بوابة العميل الموحدة:", input.url,
    language === "en" ? "Use your vehicle's plate number and letters to open it. Plate letters may be entered in English. Do not share the link or your plate details." : "استخدم رقم لوحة مركبتك وحروفها لفتحها. يمكن إدخال الحروف بالإنجليزية. لا تشارك الرابط أو بيانات اللوحة.");
  return lines.join("\n");
}
