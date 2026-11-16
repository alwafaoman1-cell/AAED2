/** Identity numbers stay text: no numeric parsing, fixed country format or lost zeros. */
export function normalizeIntakeSignerIdentity(name: string, idNumber: string) {
  const fullName = typeof name === "string" ? name.trim() : "";
  const identityNumber = (typeof idNumber === "string" ? idNumber : "").trim().replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) =>
    String(digit.charCodeAt(0) - (digit.charCodeAt(0) <= 0x0669 ? 0x0660 : 0x06f0)));
  const hasControlCharacters = (value: string) => Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || (code >= 127 && code <= 159);
  });
  const valid = Array.from(fullName).length >= 1 && Array.from(fullName).length <= 160
    && Array.from(identityNumber).length >= 1 && Array.from(identityNumber).length <= 80
    && !hasControlCharacters(typeof name === "string" ? name : "")
    && !hasControlCharacters(typeof idNumber === "string" ? idNumber : "");
  return { fullName, idNumber: identityNumber, valid };
}
