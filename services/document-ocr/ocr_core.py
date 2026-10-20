"""Isolated document OCR core. No Supabase credentials, PII logs, or shell calls.

The deployment adapter may fetch bytes from a private bucket and supply them here.
It must validate the authenticated tenant, file scope, content hash and job lease.
"""
from __future__ import annotations

import hashlib
import io
import datetime
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

MAX_BYTES = 12 * 1024 * 1024
MAX_PAGES = 8
MAX_PIXELS = 32_000_000
SIGNATURES = {
    ".pdf": ("application/pdf", lambda b: b.startswith(b"%PDF-")),
    ".jpg": ("image/jpeg", lambda b: b.startswith(b"\xff\xd8\xff")),
    ".jpeg": ("image/jpeg", lambda b: b.startswith(b"\xff\xd8\xff")),
    ".png": ("image/png", lambda b: b.startswith(b"\x89PNG\r\n\x1a\n")),
    ".webp": ("image/webp", lambda b: b.startswith(b"RIFF") and b[8:12] == b"WEBP"),
}


class InvalidDocument(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class ValidatedDocument:
    mime: str
    sha256: str
    pages: int
    byte_size: int


def validate_document(raw: bytes, filename: str, declared_mime: str, expected_sha256: str | None = None) -> ValidatedDocument:
    if not raw or len(raw) > MAX_BYTES:
        raise InvalidDocument("DOCUMENT_SIZE_INVALID")
    suffix = Path(filename).suffix.lower()
    signature = SIGNATURES.get(suffix)
    if not signature or not signature[1](raw) or signature[0] != declared_mime:
        raise InvalidDocument("DOCUMENT_SIGNATURE_MISMATCH")
    digest = hashlib.sha256(raw).hexdigest()
    if expected_sha256 and digest != expected_sha256:
        raise InvalidDocument("DOCUMENT_HASH_MISMATCH")
    if declared_mime == "application/pdf":
        import pymupdf
        try:
            with pymupdf.open(stream=raw, filetype="pdf") as pdf:
                if pdf.needs_pass or not 1 <= pdf.page_count <= MAX_PAGES:
                    raise InvalidDocument("DOCUMENT_PDF_PAGE_LIMIT")
                for page in pdf:
                    if page.rect.width <= 0 or page.rect.height <= 0:
                        raise InvalidDocument("DOCUMENT_PDF_CORRUPT")
                pages = pdf.page_count
        except InvalidDocument:
            raise
        except Exception as exc:
            raise InvalidDocument("DOCUMENT_PDF_CORRUPT") from exc
    else:
        from PIL import Image, ImageFile, UnidentifiedImageError
        Image.MAX_IMAGE_PIXELS = MAX_PIXELS
        ImageFile.LOAD_TRUNCATED_IMAGES = False
        try:
            with Image.open(io.BytesIO(raw)) as image:
                if image.width * image.height > MAX_PIXELS:
                    raise InvalidDocument("DOCUMENT_IMAGE_PIXEL_LIMIT")
                image.verify()
            pages = 1
        except InvalidDocument:
            raise
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise InvalidDocument("DOCUMENT_IMAGE_CORRUPT") from exc
    return ValidatedDocument(declared_mime, digest, pages, len(raw))


def _image_pages(raw: bytes, mime: str):
    from PIL import Image, ImageOps
    if mime == "application/pdf":
        import pymupdf
        with pymupdf.open(stream=raw, filetype="pdf") as pdf:
            for number, page in enumerate(pdf, 1):
                native = page.get_text("text", sort=True)
                # A scanned form may have a short selectable header or footer.
                # Character count alone cannot establish that its image content
                # was read. Small logos do not trigger the expensive OCR path.
                page_area = page.rect.width * page.rect.height
                image_area = sum((pymupdf.Rect(info["bbox"]) & page.rect).get_area()
                                 for info in page.get_image_info())
                has_document_image = page_area > 0 and image_area / page_area >= 0.45
                if len(re.sub(r"\s", "", native)) >= 45 and not has_document_image:
                    yield number, None, native, int(page.rect.width), int(page.rect.height)
                    continue
                pixels = page.get_pixmap(matrix=pymupdf.Matrix(2.5, 2.5), alpha=False)
                if pixels.width * pixels.height > MAX_PIXELS:
                    raise InvalidDocument("DOCUMENT_IMAGE_PIXEL_LIMIT")
                image = Image.open(io.BytesIO(pixels.tobytes("png"))).convert("RGB")
                yield number, image, native, image.width, image.height
    else:
        image = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
        yield 1, image, "", image.width, image.height


def _variants(image: Any):
    import cv2
    import numpy as np
    source = np.asarray(image)
    yield "original", source
    lab = cv2.cvtColor(source, cv2.COLOR_RGB2LAB)
    light, a, b = cv2.split(lab)
    enhanced = cv2.createCLAHE(clipLimit=1.6, tileGridSize=(8, 8)).apply(light)
    yield "local_contrast", cv2.cvtColor(cv2.merge((enhanced, a, b)), cv2.COLOR_LAB2RGB)


def _line(text: str, confidence: float, box: list[float]) -> dict[str, Any]:
    return {"text": text, "confidence": max(0.0, min(1.0, confidence)),
            "box": {"x": box[0], "y": box[1], "width": box[2], "height": box[3]}}


def _merge_pdf_text(native: str, recognized: str) -> str:
    """Retain the selectable layer and add only lines missing from it."""
    native_lines = [line.strip() for line in native.splitlines() if line.strip()]
    seen = {re.sub(r"\s+", " ", line).casefold() for line in native_lines}
    result = native_lines[:]
    for line in recognized.splitlines():
        cleaned = line.strip()
        key = re.sub(r"\s+", " ", cleaned).casefold()
        if key and key not in seen:
            result.append(cleaned)
            seen.add(key)
    return "\n".join(result)


def _ocr_score(text: str, confidence: float) -> float:
    # Confidence alone favored a flawless 50-character fragment over the
    # remainder of a scanned page. Still reject long low-confidence noise.
    characters = len(re.sub(r"\s", "", text))
    if not characters:
        return 0.0
    # Prefer a readable form over a longer block of legal boilerplate. These
    # bonuses require printed labels and values; they never synthesize fields.
    reference = bool(re.search(r"\b(?:C/[A-Z0-9]+(?:/[A-Z0-9]+){3,}|\d{2,4}/\d{3,5}/\d{4}/C/\d{4,})\b", text, re.I))
    loss_date = bool(re.search(r"(?:date\s+of\s+(?:loss|accident)|تاريخ\s+الحادث)\s*[:：/-]?\s*\d{1,2}/\d{1,2}/\d{4}", text, re.I))
    return confidence * (0.35 + 0.65 * min(1.0, characters / 1000)) + 0.06 * reference + 0.04 * loss_date


def _probably_complete_ocr(text: str, segments: list[dict[str, Any]], confidence: float, height: int) -> bool:
    if confidence < 0.88 or len(re.sub(r"\s", "", text)) < 500 or height <= 0:
        return False
    boxes = [segment["box"] for segment in segments if segment.get("box", {}).get("height", 0) > 0]
    return bool(boxes) and min(box["y"] for box in boxes) <= height * 0.25 and \
        max(box["y"] + box["height"] for box in boxes) >= height * 0.72


class TesseractProvider:
    name = "tesseract"
    version = "5"

    def __init__(self):
        import pytesseract
        pytesseract.get_tesseract_version()  # fail at setup, not halfway through a corpus

    def recognize(self, image: Any) -> tuple[str, list[dict[str, Any]], float]:
        import pytesseract
        from pytesseract import Output
        from PIL import Image
        data = pytesseract.image_to_data(Image.fromarray(image), lang="ara+eng", config="--psm 3", output_type=Output.DICT)
        lines: dict[tuple[int, int, int], list[tuple[str, float, list[float]]]] = {}
        for index, raw in enumerate(data["text"]):
            text = raw.strip()
            if not text:
                continue
            try:
                confidence = max(0.0, float(data["conf"][index])) / 100
            except ValueError:
                confidence = 0.0
            key = (data["block_num"][index], data["par_num"][index], data["line_num"][index])
            lines.setdefault(key, []).append((text, confidence, [data["left"][index], data["top"][index], data["width"][index], data["height"][index]]))
        segments = []
        for words in lines.values():
            x = min(word[2][0] for word in words); y = min(word[2][1] for word in words)
            right = max(word[2][0] + word[2][2] for word in words)
            bottom = max(word[2][1] + word[2][3] for word in words)
            segments.append(_line(" ".join(word[0] for word in words), sum(word[1] for word in words) / len(words), [x, y, right - x, bottom - y]))
        return "\n".join(segment["text"] for segment in segments), segments, (sum(segment["confidence"] for segment in segments) / len(segments) if segments else 0)


class PaddleProvider:
    name = "paddleocr"
    version = "PP-OCRv5-en-insurer-forms-ar-fallback"

    def __init__(self):
        from paddleocr import PaddleOCR
        # Most submitted gate passes are English. Keep the Arabic model lazy:
        # a clear English page should not pay for loading or running it.
        self._pipeline = None
        self._english_first = True
        self._english_pipeline = PaddleOCR(device="cpu",
                                           text_detection_model_name="PP-OCRv5_mobile_det",
                                           text_recognition_model_name="en_PP-OCRv5_mobile_rec",
                                           enable_mkldnn=False, cpu_threads=2,
                                           use_doc_orientation_classify=False, use_doc_unwarping=False,
                                           use_textline_orientation=False)

    def warm_english_model(self):
        if self._english_pipeline is None:
            from paddleocr import PaddleOCR
            self._english_pipeline = PaddleOCR(device="cpu",
                                               text_detection_model_name="PP-OCRv5_mobile_det",
                                               text_recognition_model_name="en_PP-OCRv5_mobile_rec",
                                               enable_mkldnn=False, cpu_threads=2,
                                               use_doc_orientation_classify=False, use_doc_unwarping=False,
                                               use_textline_orientation=False)

    def warm_arabic_model(self):
        if self._pipeline is None:
            from paddleocr import PaddleOCR
            self._pipeline = PaddleOCR(device="cpu",
                                       text_detection_model_name="PP-OCRv5_mobile_det",
                                       text_recognition_model_name="arabic_PP-OCRv5_mobile_rec",
                                       enable_mkldnn=False, cpu_threads=2,
                                       use_doc_orientation_classify=False, use_doc_unwarping=False,
                                       use_textline_orientation=False)

    @staticmethod
    def _segments(results: Any) -> list[dict[str, Any]]:
        segments = []
        for item in results:
            payload = item.json.get("res", item.json)
            texts = payload.get("rec_texts", []); scores = payload.get("rec_scores", [])
            polygons = payload.get("rec_polys", [])
            for index, text in enumerate(texts):
                polygon = polygons[index] if index < len(polygons) else []
                if len(polygon):
                    xs = [float(point[0]) for point in polygon]; ys = [float(point[1]) for point in polygon]
                    box = [min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)]
                else:
                    box = [0, 0, 0, 0]
                segments.append(_line(text, float(scores[index]) if index < len(scores) else 0, box))
        return segments

    @staticmethod
    def _result(segments: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]], float]:
        return ("\n".join(segment["text"] for segment in segments), segments,
                sum(segment["confidence"] for segment in segments) / len(segments) if segments else 0)

    @staticmethod
    def _labeled_value(segments: list[dict[str, Any]], label: str, value: str) -> bool:
        label_pattern, value_pattern = re.compile(label, re.I), re.compile(value, re.I)
        other_label = re.compile(
            r"\b(?:claim\s*(?:no\.?|number|reference)|date\s+of\s+\w+|incident\s+date|"
            r"vehicle\s+(?:no\.?|make)|registration\s+(?:no\.?|number)|plate\s+(?:no\.?|number)|"
            r"customer\s+name|owner\s+name|name\s+of\s+driver|make\s*/\s*model)\b", re.I)
        for anchor in segments:
            match = label_pattern.search(anchor["text"])
            if not match:
                continue
            tail = anchor["text"][match.end():]
            inline = value_pattern.search(tail)
            if inline and not other_label.search(tail[:inline.start()]):
                return True
            box = anchor.get("box") or {}
            if box.get("height", 0) <= 0:
                continue
            center = box["y"] + box["height"] / 2
            for neighbor in segments:
                if neighbor is anchor:
                    continue
                observed = value_pattern.search(neighbor["text"])
                if not observed or other_label.search(neighbor["text"][:observed.start()]):
                    continue
                candidate = neighbor.get("box") or {}
                if candidate.get("height", 0) <= 0:
                    continue
                same_row = abs(center - candidate["y"] - candidate["height"] / 2) <= max(box["height"], candidate["height"]) * .7
                to_right = box["x"] + box["width"] * .5 <= candidate["x"] <= box["x"] + box["width"] + 1000
                blocked = any(other is not anchor and other is not neighbor and
                              box["x"] + box["width"] <= (other.get("box") or {}).get("x", -1) < candidate["x"] and
                              abs(center - (other["box"]["y"] + other["box"]["height"] / 2)) <=
                              max(box["height"], other["box"]["height"]) * .7 and
                              other_label.search(other["text"])
                              for other in segments if (other.get("box") or {}).get("height", 0) > 0)
                if same_row and to_right and not blocked:
                    return True
        return False

    @classmethod
    def _english_claim_evidence(cls, segments: list[dict[str, Any]]) -> int:
        reference = r"\b(?:C/[A-Z0-9]+(?:/[A-Z0-9]+){3,}|\d{2,4}/\d{3,5}/\d{4}/C/\d{4,})\b"
        date = r"\b\d{1,2}/\d{1,2}/\d{4}\b"
        plate = r"\b(?:[A-Z]{1,3}\s*){1,2}[/ ]\s*\d{2,7}\b"
        person = r"\b(?!(?:the vehicle|owner of|customer name|name of driver)\b)[A-Z][A-Z'.-]*(?:\s+[A-Z][A-Z'.-]*){1,}\b"
        vehicle = r"\b[A-Z][A-Z0-9 -]{1,30}\s*[-/]\s*[A-Z0-9][A-Z0-9 -]{1,30}\b"
        return sum((
            cls._labeled_value(segments, r"claim\s*(?:no\.?|number|reference)", reference),
            cls._labeled_value(segments, r"date\s+of\s+(?:loss|accident)|incident\s+date", date),
            cls._labeled_value(segments, r"vehicle\s+no\.?|registration\s+no\.?(?:umber)?|plate\s+no\.?(?:umber)?", plate),
            cls._labeled_value(segments, r"customer\s+name|name\s+of\s+driver(?:,\s*owner\s+of)?|owner\s+name", person),
            cls._labeled_value(segments, r"vehicle\s+make\s*(?:&|and|/)\s*model|make\s*/\s*model", vehicle),
        ))

    @classmethod
    def _english_claim_complete(cls, segments: list[dict[str, Any]], confidence: float) -> bool:
        # A high-scoring header is not a complete claim. Require all five
        # labeled values on their own physical rows before skipping fallback.
        return confidence >= .70 and cls._english_claim_evidence(segments) == 5

    @classmethod
    def _english_lpo_complete(cls, segments: list[dict[str, Any]], confidence: float) -> bool:
        """Do not OCR a clearly filled English repair order again in Arabic.

        All evidence is attached to its own printed label/row. In particular,
        the print/issue date cannot stand in for the accident date and the
        insurer's footer total cannot become the approved repair total.
        """
        text = "\n".join(segment["text"] for segment in segments)
        if confidence < .70 or not re.search(r"motor\s+vehicle\s+repair\s+order", text, re.I):
            return False
        reference = r"\b\d{2,4}/\d{3,5}/\d{4}/C/\d{4,}\b"
        date = r"\b\d{1,2}/\d{1,2}/\d{4}\b"
        plate = r"\b(?:[A-Z]{1,3}\s*){1,2}[/ ]\s*\d{2,7}\b"
        person = r"\b[A-Z][A-Z'.-]*(?:\s+[A-Z][A-Z'.-]*){1,}\b"
        money = r"\b\d{1,3}(?:,\d{3})*\.\d{3}\b"
        complete = (
            cls._labeled_value(segments, r"\bLPO\s*No\.?", r"\b\d{3,10}\b"),
            cls._labeled_value(segments, r"(?:ref\.\s*our\s+)?claim\s*no\.?", reference),
            cls._labeled_value(segments, r"accident\s+date", date),
            cls._labeled_value(segments, r"\bowners\b|owner\s+name", person),
            cls._labeled_value(segments, r"regn\.?\s*no\.?|registration\s+no\.?(?:umber)?", plate),
            cls._labeled_value(segments, r"^make\b", r"\b[A-Z][A-Z0-9-]{1,20}\b"),
            cls._labeled_value(segments, r"^model\b", r"\b[A-Z][A-Za-z0-9 -]{1,30}\b"),
            cls._labeled_value(segments, r"^total\b", money),
        )
        return all(complete)

    def complete_document(self, segments: list[dict[str, Any]], confidence: float) -> bool:
        # A short English gate pass can have every critical field while still
        # missing the generic 500-character threshold. Do not OCR the entire
        # page again just to read boilerplate; review still guards each field.
        return PaddleProvider._english_lpo_complete(segments, confidence) or self._english_claim_complete(segments, confidence)

    def should_stop_after_variant(self, text: str, segments: list[dict[str, Any]],
                                  confidence: float, height: int) -> bool:
        claim_like = bool(re.search(r"claim\s*(?:no\.?|number)|repair\s+gate\s+pass|"
                                    r"gate\s+pass\s+to|motor\s+vehicle\s+repair\s+order|رقم\s+المطالبة", text, re.I))
        # A long page of clear legal text must not hide a missing plate/date.
        # On non-claim documents keep the pre-existing generic completeness gate.
        return self.complete_document(segments, confidence) if claim_like else \
            _probably_complete_ocr(text, segments, confidence, height)

    def _recover_english_rows(self, image: Any, segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if image is None or not hasattr(image, "shape"):
            return segments
        # Re-read at most three incomplete identity rows at higher resolution.
        # The crop is anchored to the OCR label, not a fixed insurer template.
        import cv2
        import numpy as np
        recovered = list(segments)
        specs = (
            (r"claim\s*(?:no\.?|number|reference)", r"\b(?:C/[A-Z0-9]+(?:/[A-Z0-9]+){3,}|\d{2,4}/\d{3,5}/\d{4}/C/\d{4,})\b"),
            (r"date\s+of\s+(?:loss|accident)|incident\s+date", r"\b\d{1,2}/\d{1,2}/\d{4}\b"),
            (r"vehicle\s+no\.?|registration\s+(?:no\.?|number)|regn\.?\s*no\.?|plate\s+(?:no\.?|number)", r"\b(?:[A-Z]{1,3}\s*){1,2}[/ ]\s*\d{2,7}\b"),
        )
        attempts = 0
        for label, value in specs:
            if self._labeled_value(recovered, label, value):
                continue
            for anchor in segments:
                if not re.search(label, anchor["text"], re.I):
                    continue
                box = anchor.get("box") or {}
                if box.get("width", 0) <= 0 or box.get("height", 0) <= 0:
                    continue
                left = max(0, int(box["x"] - 6))
                top = max(0, int(box["y"] - box["height"] * .3))
                right = min(image.shape[1], int(box["x"] + box["width"] + image.shape[1] * .48))
                bottom = min(image.shape[0], int(box["y"] + box["height"] * 1.3))
                if right - left < 40 or bottom - top < 15:
                    continue
                attempts += 1
                crop = np.ascontiguousarray(image[top:bottom, left:right])
                enlarged = cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
                candidates = self._segments(self._english_pipeline.predict(enlarged))
                matches = [candidate for candidate in candidates if candidate["confidence"] >= .80 and
                           re.search(value, candidate["text"], re.I)]
                if matches:
                    winner = max(matches, key=lambda candidate: candidate["confidence"])
                    winner["box"] = {"x": left + winner["box"]["x"] / 2,
                                     "y": top + winner["box"]["y"] / 2,
                                     "width": winner["box"]["width"] / 2,
                                     "height": winner["box"]["height"] / 2}
                    recovered.append(winner)
                    break
                if attempts >= 3:
                    return recovered
            if attempts >= 3:
                break
        return recovered

    def recognize(self, image: Any) -> tuple[str, list[dict[str, Any]], float]:
        # A test provider built without __init__ retains the legacy Arabic
        # path, so existing Arabic recovery cases remain independently tested.
        if not getattr(self, "_english_first", False):
            return self._recognize_arabic(image)
        english_segments = self._segments(self._english_pipeline.predict(image))
        if not self.complete_document(english_segments, self._result(english_segments)[2]):
            english_segments = self._recover_english_rows(image, english_segments)
        english = self._result(english_segments)
        if self.complete_document(english_segments, english[2]):
            return english
        self.warm_arabic_model()
        arabic = self._recognize_arabic(image, english_segments)
        # Compare actual recognized evidence, not a language preference.
        # Preserve the English result when it contains a clear reference even
        # if the Arabic model read more surrounding bilingual boilerplate.
        english_score = _ocr_score(english[0], english[2]) + .07 * self._english_claim_evidence(english_segments)
        arabic_score = _ocr_score(arabic[0], arabic[2])
        return english if english_score >= arabic_score else arabic

    def _recognize_arabic(self, image: Any, english_segments: list[dict[str, Any]] | None = None) -> tuple[str, list[dict[str, Any]], float]:
        segments = self._segments(self._pipeline.predict(image))
        # On bilingual gate passes a dense "Year / السنة : 2021" cell may be
        # recognized as only "21السنة". Re-read that cell at higher resolution,
        # anchored to the vehicle row, rather than guessing a year from the
        # policy/accident dates elsewhere on the page.
        if image is not None:
            vehicle_labels = [segment for segment in segments
                              if "Vehicle Make & Model" in segment["text"]]
            year_labels = [segment for segment in segments if "السنة" in segment["text"]]
            for label in year_labels:
                box = label["box"]
                center = box["y"] + box["height"] / 2
                aligned = any(abs(center - vehicle["box"]["y"] - vehicle["box"]["height"] / 2)
                              <= max(box["height"], vehicle["box"]["height"]) * 0.8
                              for vehicle in vehicle_labels)
                if not aligned or box["width"] <= 0 or box["height"] <= 0:
                    continue
                if any(re.fullmatch(r"(?:19|20)\d{2}", segment["text"].strip()) and
                       abs(segment["box"]["y"] + segment["box"]["height"] / 2 - center)
                       <= max(box["height"], segment["box"]["height"]) * 0.65
                       for segment in segments):
                    continue
                import cv2
                import numpy as np
                left = max(0, int(box["x"] + box["width"] * 0.35))
                top = max(0, int(box["y"] - 5))
                right = min(image.shape[1], int(box["x"] + box["width"] + max(90, box["height"] * 3)))
                bottom = min(image.shape[0], int(box["y"] + box["height"] + 7))
                if right - left < 30 or bottom - top < 20:
                    continue
                crop = np.ascontiguousarray(image[top:bottom, left:right])
                enlarged = cv2.resize(crop, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
                recovered = [candidate for candidate in self._segments(self._pipeline.predict(enlarged))
                             if candidate["confidence"] >= 0.90 and
                             re.fullmatch(r"(?:19|20)\d{2}", candidate["text"].strip())]
                if len({candidate["text"].strip() for candidate in recovered}) != 1:
                    continue
                candidate = max(recovered, key=lambda item: item["confidence"])
                candidate["box"] = {"x": left + candidate["box"]["x"] / 3,
                                    "y": top + candidate["box"]["y"] / 3,
                                    "width": candidate["box"]["width"] / 3,
                                    "height": candidate["box"]["height"] / 3}
                segments.append(candidate)
                break
        # Whole-line Arabic recognition can retain a label but drop a compact
        # Arabic-Indic value. Re-read only the value side of the detected line;
        # the crop is derived from OCR coordinates, not from a document template.
        digit = r"[0-9٠-٩۰-۹]"
        date_pattern = re.compile(digit + r"{1,4}\s*[/.-]\s*" + digit + r"{1,2}\s*[/.-]\s*" + digit + r"{2,4}")

        def unambiguous_compact_date(value: str) -> bool:
            digits = value.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789"))
            if not re.fullmatch(r"\d{8}", digits):
                return False
            day, month, year = int(digits[:2]), int(digits[2:4]), int(digits[4:])
            if day <= 12 or year < 1900 or year > 2100:
                return False  # Both dd/mm and mm/dd could otherwise be plausible.
            try:
                datetime.date(year, month, day)
                return True
            except ValueError:
                return False
        for label_text, complete, share, margin in (("رقم اللوحة", re.compile(digit + r"{2,7}"), 0.60, 18),
                                                    ("تاريخ الحادث", date_pattern, 0.60, 14)):
            labels_for_value = [segment for segment in segments if label_text in segment["text"] and
                                (not complete.search(segment["text"]) or
                                 (label_text == "رقم اللوحة" and
                                  len(complete.search(segment["text"]).group()) < 3))]
            for label in labels_for_value:
                import numpy as np
                box = label["box"]
                left = max(0, int(box["x"] - (20 if label_text == "رقم اللوحة" else 13)))
                top = max(0, int(box["y"] - margin))
                right = min(image.shape[1], int(box["x"] + box["width"] * share))
                bottom = min(image.shape[0], int(box["y"] + box["height"] + (18 if label_text == "تاريخ الحادث" else 8)))
                if right - left < 30 or bottom - top < 20:
                    continue
                observed_dates = {}
                # Very small crop changes can turn a printed slash into a
                # digit. Require two independent crop widths to agree on all
                # eight digits before accepting a separator-free date.
                for offset in ([0, 2, 10, 12] if label_text == "تاريخ الحادث" else [0]):
                    crop = np.ascontiguousarray(image[top:bottom, left:min(image.shape[1], right + offset)])
                    for candidate in self._segments(self._pipeline.predict(crop)):
                        value = candidate["text"].strip()
                        valid_format = (re.fullmatch(digit + r"{2,7}", value) if label_text == "رقم اللوحة"
                                        else date_pattern.fullmatch(value) or unambiguous_compact_date(value))
                        if candidate["confidence"] < 0.70 or not valid_format:
                            continue
                        if label_text == "رقم اللوحة":
                            observed = complete.search(label["text"])
                            if observed and len(value) <= len(observed.group()):
                                continue
                            candidate["box"]["x"] += left; candidate["box"]["y"] += top
                            segments.append(candidate)
                        else:
                            key = value.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789"))
                            observed_dates.setdefault(key, []).append(candidate)
                if label_text == "تاريخ الحادث":
                    for agreeing in observed_dates.values():
                        if len(agreeing) < 2:
                            continue
                        winner = max(agreeing, key=lambda item: item["confidence"])
                        winner["confidence"] = min(item["confidence"] for item in agreeing)
                        winner["box"]["x"] += left; winner["box"]["y"] += top
                        segments.append(winner)
                        break
        # The Arabic recognizer reads the label but can discard an adjacent
        # Latin claim reference. Run the English recognizer only in that case;
        # accept only a complete reference on the same physical line as the
        # Arabic label. Never construct missing digits from a template.
        from difflib import SequenceMatcher
        labels = [segment for segment in segments if
                  "رقم المطالبة" in segment["text"] or segment["text"].strip() == "المطالبة" or
                  (segment["text"].strip().startswith("رقم ") and
                   SequenceMatcher(None, segment["text"].strip()[:12], "رقم المطالبة").ratio() >= 0.72)]
        reference = re.compile(r"\bC/[A-Z0-9]+(?:/[A-Z0-9]+){3,}\b", re.I)
        if labels and not any(reference.search(segment["text"]) for segment in segments):
            if english_segments is None:
                self.warm_english_model()
                english_segments = self._segments(self._english_pipeline.predict(image))
            for candidate in english_segments:
                if candidate["confidence"] < 0.75 or not reference.search(candidate["text"]):
                    continue
                center = candidate["box"]["y"] + candidate["box"]["height"] / 2
                aligned = any(abs(center - label["box"]["y"] - label["box"]["height"] / 2)
                              <= max(candidate["box"]["height"], label["box"]["height"]) for label in labels)
                if aligned:
                    segments.append(candidate)
        return self._result(segments)


def process_document(raw: bytes, filename: str, declared_mime: str, provider: Any,
                     expected_sha256: str | None = None) -> dict[str, Any]:
    validation = validate_document(raw, filename, declared_mime, expected_sha256)
    started = time.monotonic()
    output = []
    issues = []
    for number, image, native_text, width, height in _image_pages(raw, validation.mime):
        if image is None:
            output.append({"number": number, "text": native_text[:200_000], "method": "native_pdf",
                           "confidence": 0.99, "width": width, "height": height, "segments": []})
            continue
        best = ("", [], 0.0, "original")
        best_structured_complete = False
        for name, variant in _variants(image):
            text, segments, confidence = provider.recognize(variant)
            complete_document = getattr(provider, "complete_document", None)
            structured_complete = bool(complete_document(segments, confidence)) if complete_document else False
            if (structured_complete and not best_structured_complete) or \
               (structured_complete == best_structured_complete and
                _ocr_score(text, confidence) > _ocr_score(best[0], best[2])):
                best = (text, segments, confidence, name)
                best_structured_complete = structured_complete
            stop_after_variant = getattr(provider, "should_stop_after_variant", None)
            if (stop_after_variant(text, segments, confidence, height) if stop_after_variant else
                    _probably_complete_ocr(text, segments, confidence, height)):
                break
        merged = _merge_pdf_text(native_text, best[0]) if native_text else best[0]
        if not best[0].strip():
            issues.append({"code": "OCR_NO_TEXT", "severity": "warning",
                           "message": f"Page {number} contains an image but OCR found no readable text; review it manually."})
        method = "ocr" if best[0].strip() or not native_text.strip() else "native_pdf"
        output.append({"number": number, "text": merged[:200_000], "method": method,
                       "confidence": round(best[2] if method == "ocr" else 0.95, 3), "width": width, "height": height,
                       "segments": best[1][:1000], "variant": best[3]})
    return {"engine": provider.name, "model_version": provider.version, "sha256": validation.sha256,
            "pages": output, "issues": issues,
            "duration_ms": round((time.monotonic() - started) * 1000), "ai_used": False}
