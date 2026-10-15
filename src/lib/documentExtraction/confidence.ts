import type { DocumentExtractionResult } from "./types";

/** Document score is recomputed after validation, DB matching and optional AI. */
export function overallDocumentConfidence(result: DocumentExtractionResult): number {
  const fields = Object.values(result.fields);
  if (!fields.length) return 0;
  const fieldAverage = fields.reduce((sum, field) => sum + field.confidence, 0) / fields.length;
  let score = fieldAverage * (0.8 + 0.2 * result.documentTypeConfidence);
  if (result.issues.some((issue) => issue.severity === "error")) score = Math.min(score, 0.35);
  if (result.matchingStatus === "failed") score = Math.min(score, 0.6);
  return Number(Math.max(0, Math.min(0.99, score)).toFixed(3));
}
