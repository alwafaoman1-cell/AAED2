export interface ClaimCopyReferenceInput {
  claimNumber?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  plateNumber?: string | null;
  plateLetters?: string | null;
}

const cleanReferencePart = (value: unknown) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");

export function buildClaimCopyReference(input: ClaimCopyReferenceInput): string {
  const claimNumber = cleanReferencePart(input.claimNumber);
  const make = cleanReferencePart(input.vehicleMake);
  const model = cleanReferencePart(input.vehicleModel);
  const plateLetters = cleanReferencePart(input.plateLetters).replace(/^\/+|\/+$/g, "");
  let plateNumber = cleanReferencePart(input.plateNumber).replace(/\s*\/\s*/g, "/");

  if (plateLetters) {
    const normalizedPlate = plateNumber.toLocaleUpperCase("en-US");
    const normalizedLetters = plateLetters.toLocaleUpperCase("en-US");
    if (!normalizedPlate.endsWith(`/${normalizedLetters}`)) {
      plateNumber = plateNumber ? `${plateNumber}/${plateLetters}` : plateLetters;
    }
  }

  return [claimNumber, make, model, plateNumber]
    .filter(Boolean)
    .join(" ")
    .toLocaleUpperCase("en-US");
}
