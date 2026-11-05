import type { VehicleTechnicalDeclarationForm } from "./vehicleTechnicalDeclaration";

export interface TechnicalDeclarationField {
  key: keyof VehicleTechnicalDeclarationForm;
  ar: string;
  en: string;
  kind: "text" | "date" | "choice" | "oil" | "chassis" | "checkbox" | "textarea";
}

// Shared by the controlled inputs and intake summary. These are the existing
// declaration's labels, not a second form/schema or a global locale override.
export const technicalDeclarationIdentityFields: TechnicalDeclarationField[] = [
  { key: "claim_number", ar: "رقم المطالبة", en: "Claim Number", kind: "text" },
  { key: "registration_number", ar: "رقم التسجيل / اللوحة", en: "Registration Number", kind: "text" },
  { key: "make_model", ar: "الماركة والموديل", en: "Make & Model", kind: "text" },
  { key: "non_gcc_vehicle", ar: "المركبة من خارج دول الخليج", en: "Non GCC Vehicle", kind: "choice" },
  { key: "towing", ar: "أُحضرت برافعة", en: "Towing", kind: "choice" },
];

export const technicalDeclarationSections: Array<{ number: number; ar: string; en: string; fields: TechnicalDeclarationField[] }> = [
  { number: 1, ar: "حالة المحرك", en: "Engine Status", fields: [
    { key: "cranking", ar: "يدور المحرك", en: "Cranking", kind: "choice" },
    { key: "engine_oil_level", ar: "مستوى زيت المحرك", en: "Engine Oil Level", kind: "oil" },
    { key: "radiator_coolant", ar: "سائل تبريد الرادياتير", en: "Radiator Coolant", kind: "choice" },
    { key: "engine_other_remarks", ar: "ملاحظات أخرى", en: "Other Remarks", kind: "text" },
  ] },
  { number: 2, ar: "حالة صندوق التروس", en: "Gear Box Status", fields: [
    { key: "gear_body_crack", ar: "شقوق ظاهرة في الهيكل", en: "Any Body crack Observed", kind: "choice" },
    { key: "gear_oil_leak", ar: "تسرب زيت ظاهر", en: "Any oil leak observed", kind: "choice" },
    { key: "gear_other_remarks", ar: "ملاحظات أخرى", en: "Other Remarks", kind: "text" },
  ] },
  { number: 3, ar: "إصلاحات سابقة غير سليمة", en: "Previous Improper Repairs Observed", fields: [
    { key: "previous_improper_repairs", ar: "هل وُجدت إصلاحات سابقة غير سليمة؟", en: "Previous Improper Repairs Observed", kind: "choice" },
    { key: "previous_improper_details", ar: "التفاصيل إن وُجدت", en: "If Yes, Details", kind: "textarea" },
  ] },
  { number: 4, ar: "لمبات التحذير في لوحة العدادات", en: "Dash board warning lamp", fields: [
    { key: "airbag_warning", ar: "تحذير الوسائد الهوائية", en: "Air bag warning", kind: "choice" },
    { key: "engine_warning", ar: "تحذير المحرك", en: "Engine warning", kind: "choice" },
    { key: "atm_warning", ar: "تحذير ATM", en: "ATM warning", kind: "choice" },
    { key: "warning_other", ar: "أخرى", en: "Other", kind: "text" },
  ] },
  { number: 5, ar: "ملاحظة حالة الشاصي", en: "Chassis Status Observation", fields: [
    { key: "chassis_status", ar: "حالة الشاصي", en: "Chassis Status", kind: "chassis" },
    { key: "chassis_damage_lh", ar: "ضرر شاصي يسار LH", en: "Chassis damage LH", kind: "checkbox" },
    { key: "chassis_damage_rh", ar: "ضرر شاصي يمين RH", en: "Chassis damage RH", kind: "checkbox" },
    { key: "chassis_replace_lh", ar: "يوصى باستبدال يسار LH", en: "Recommend replace LH", kind: "checkbox" },
    { key: "chassis_replace_rh", ar: "يوصى باستبدال يمين RH", en: "Recommend replace RH", kind: "checkbox" },
    { key: "chassis_notes", ar: "تفاصيل إضافية", en: "Additional details", kind: "text" },
  ] },
  { number: 6, ar: "تشوهات الهيكل والأرضية", en: "Body & Floor Deformation Observed", fields: [
    { key: "floor_deformation", ar: "تشوه الأرضية", en: "Floor deformation", kind: "choice" },
    { key: "body_deformation", ar: "تشوه الهيكل", en: "Body Deformation", kind: "choice" },
    { key: "body_floor_details", ar: "التفاصيل إن وُجدت", en: "If Yes, Details", kind: "text" },
  ] },
  { number: 7, ar: "الإضافات والتعديلات", en: "Any extra accessories/Modification", fields: [
    { key: "accessories_modification", ar: "إكسسوارات أو تعديلات إضافية", en: "Extra accessories/Modification", kind: "choice" },
    { key: "ppe", ar: "PPE", en: "PPE", kind: "choice" },
    { key: "accessories_details", ar: "التفاصيل إن وُجدت", en: "If Yes, Details", kind: "text" },
  ] },
  { number: 8, ar: "ملاحظات أخرى", en: "Other Observations and Remarks", fields: [
    { key: "other_observations", ar: "الملاحظات", en: "Other Observations and Remarks", kind: "textarea" },
  ] },
];

export const technicalDeclarationFooterFields: TechnicalDeclarationField[] = [
  { key: "authorized_person", ar: "اسم الموقّع", en: "Signer's name", kind: "text" },
  { key: "date", ar: "تاريخ التوقيع", en: "Date", kind: "date" },
];
