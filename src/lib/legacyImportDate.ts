// Legacy spreadsheet imports use day/month/year in either slash, dash, or dot
// notation. Keep the original value when it does not match that exact format.
const DAY_FIRST_DATE = new RegExp(String.raw`^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$`);

export function normalizeLegacyImportDate(value: string): string {
  const match = value.match(DAY_FIRST_DATE);
  if (!match) return value;
  const [, day, month, year] = match;
  const fullYear = year.length === 2 ? `20${year}` : year;
  return `${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}
