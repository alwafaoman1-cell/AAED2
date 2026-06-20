// تحميل خط عربي (Amiri) لـ jsPDF لضمان عرض النص العربي بشكل صحيح
// يستخدم خط Amiri من Google Fonts (Open Source - SIL OFL)
import jsPDF from "jspdf";

let fontLoaded = false;
let fontLoadingPromise: Promise<void> | null = null;

const FONT_URL =
  "https://cdn.jsdelivr.net/npm/@fontsource/amiri@5.0.0/files/amiri-arabic-400-normal.woff";
const FONT_BOLD_URL =
  "https://cdn.jsdelivr.net/npm/@fontsource/amiri@5.0.0/files/amiri-arabic-700-normal.woff";

async function fetchAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  // ArrayBuffer → base64
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** يحمّل خط Amiri ويسجّله في jsPDF (يحدث مرة واحدة فقط). */
export async function ensureArabicFont(doc: jsPDF): Promise<void> {
  if (fontLoaded) {
    try {
      doc.setFont("Amiri", "normal");
    } catch {
      // إعادة التسجيل في حالة instance جديد
      fontLoaded = false;
    }
  }

  if (!fontLoaded) {
    if (!fontLoadingPromise) {
      fontLoadingPromise = (async () => {
        try {
          const [regular, bold] = await Promise.all([
            fetchAsBase64(FONT_URL).catch(() => null),
            fetchAsBase64(FONT_BOLD_URL).catch(() => null),
          ]);
          if (regular) {
            (doc as any).addFileToVFS("Amiri-Regular.ttf", regular);
            doc.addFont("Amiri-Regular.ttf", "Amiri", "normal");
          }
          if (bold) {
            (doc as any).addFileToVFS("Amiri-Bold.ttf", bold);
            doc.addFont("Amiri-Bold.ttf", "Amiri", "bold");
          }
          fontLoaded = !!regular;
        } catch (err) {
          console.warn("[arabicPdfFont] failed to load Amiri", err);
          fontLoaded = false;
        }
      })();
    }
    await fontLoadingPromise;
  }

  if (fontLoaded) {
    try {
      doc.setFont("Amiri", "normal");
      // R2L
      (doc as any).setR2L?.(true);
    } catch {
      /* ignore */
    }
  }
}

/** هل المحتوى يحتوي على أحرف عربية؟ */
export function hasArabic(s: any): boolean {
  if (s === null || s === undefined) return false;
  return /[\u0600-\u06FF]/.test(String(s));
}
