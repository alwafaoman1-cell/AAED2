"""Compare the same sanitized fixture corpus across OCR engines. No raw OCR/PPI logs."""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path
import os
import psutil

from ocr_core import PaddleProvider, TesseractProvider, process_document


def normalized(value: str) -> str:
    value = value.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789"))
    return re.sub(r"[\s\u200e\u200f:،,.-]", "", value).casefold()


def run(dataset: Path, emit_pages: bool = False, provider_name: str | None = None):
    manifest = json.loads((dataset / "manifest.json").read_text(encoding="utf-8"))
    if not manifest.get("sanitized") or not manifest.get("version", "").startswith("synthetic-"):
        raise SystemExit("Refusing an unverified dataset; sanitize documents first")
    cases = manifest["cases"]
    for provider_type in (TesseractProvider, PaddleProvider):
        if provider_name and provider_type.name != provider_name:
            continue
        try:
            provider = provider_type()
        except Exception as error:
            print(json.dumps({"engine": provider_type.__name__, "available": False, "error_code": type(error).__name__}))
            continue
        matches = 0; fields = 0; timings = []; peak_mb = 0
        for case in cases:
            started = time.monotonic()
            raw = (dataset / case["file"]).read_bytes()
            result = process_document(raw, case["file"], case["mime"], provider)
            if emit_pages:
                # Raw OCR text is emitted only for the generated synthetic corpus.
                # The normal benchmark never exposes document text.
                print("TEMO_OCR_PAGE " + json.dumps({"engine": provider.name, "case": case["name"],
                                                     "pages": result["pages"]}, ensure_ascii=False))
            extracted = normalized("\n".join(page["text"] for page in result["pages"]))
            case_matches = {key: normalized(str(value)) in extracted for key, value in case["expected"].items()}
            matches += sum(case_matches.values()); fields += len(case_matches)
            duration = round((time.monotonic() - started) * 1000)
            memory_mb = round(psutil.Process(os.getpid()).memory_info().rss / (1024 * 1024))
            peak_mb = max(peak_mb, memory_mb)
            timings.append(duration)
            print(json.dumps({"engine": provider.name, "case": case["name"], "match": case_matches,
                              "matched": sum(case_matches.values()), "fields": len(case_matches), "ms": duration,
                              "rss_mb": memory_mb}, ensure_ascii=False))
        print(json.dumps({"engine": provider.name, "model": provider.version, "cases": len(cases),
                          "matched": matches, "fields": fields, "field_accuracy": round(matches / fields, 4) if fields else 0,
                          "average_ms": round(sum(timings) / len(timings)) if timings else 0,
                          "peak_rss_mb": peak_mb}, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) < 2 or len(sys.argv) > 4:
        raise SystemExit("Usage: benchmark.py <generated-synthetic-dataset-directory> [--emit-pages] [paddleocr|tesseract]")
    run(Path(sys.argv[1]).resolve(), "--emit-pages" in sys.argv[2:],
        next((value for value in sys.argv[2:] if value in {"paddleocr", "tesseract"}), None))
