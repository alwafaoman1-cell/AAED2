import { downloadPdfV2, openPdfV2Window, printPdfV2 } from "@/lib/pdf-v2";

export async function printPdfBlob(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.src = url;
  frame.onload = () => {
    setTimeout(() => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } finally {
        setTimeout(() => {
          URL.revokeObjectURL(url);
          frame.remove();
        }, 60_000);
      }
    }, 300);
  };
  document.body.appendChild(frame);
}

export function openSanitizedPdfWindow(html: string): Window | null {
  return openPdfV2Window({
    html,
    meta: {
      documentType: "generic",
      title: "PDF Preview",
    },
  });
}

export async function openAndPrintWindow(html: string): Promise<void> {
  await printPdfV2({
    html,
    meta: {
      documentType: "generic",
      title: "Print",
    },
  });
}

export async function printCurrentPageAsPdf(fileName = "report"): Promise<void> {
  const blob = await downloadPdfV2(
    {
      html: document.documentElement.outerHTML,
      meta: {
        documentType: "report",
        title: fileName,
      },
    },
    fileName,
    false,
  );
  await printPdfBlob(blob);
}
