/** Keep the URL alive while mobile browsers hand a PDF to their download viewer. */
export function downloadPdfBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.hidden = true;
  document.body.appendChild(link);
  const cleanup = () => { link.remove(); URL.revokeObjectURL(url); };
  try {
    link.click();
    // Safari may still be opening the file after the first 1.5 seconds.
    setTimeout(cleanup, 60_000);
  } catch (error) {
    cleanup();
    throw error;
  }
}
