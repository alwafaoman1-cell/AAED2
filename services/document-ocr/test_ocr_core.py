import hashlib
import io
import unittest

from PIL import Image

from ocr_core import InvalidDocument, PaddleProvider, process_document, validate_document


class FakePipeline:
    def __init__(self, texts, scores, y_positions):
        self.payload = {"res": {"rec_texts": texts, "rec_scores": scores,
                                "rec_polys": [[[0, y], [500, y], [500, y + 40], [0, y + 40]]
                                              for y in y_positions]}}

    def predict(self, _image):
        return [type("Result", (), {"json": self.payload})()]


class SequencePipeline:
    def __init__(self, *pipelines):
        self.pipelines = pipelines
        self.calls = 0

    def predict(self, image):
        selected = self.pipelines[self.calls]
        self.calls += 1
        return selected.predict(image)


class FileSafetyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        image = Image.new("RGB", (100, 100), "white")
        target = io.BytesIO(); image.save(target, format="PNG")
        cls.png = target.getvalue()

    def test_valid_signature_hash_and_image_decode(self):
        result = validate_document(self.png, "example.png", "image/png", hashlib.sha256(self.png).hexdigest())
        self.assertEqual(result.pages, 1)
        self.assertEqual(result.mime, "image/png")

    def test_mime_and_extension_cannot_disagree_with_bytes(self):
        with self.assertRaisesRegex(InvalidDocument, "DOCUMENT_SIGNATURE_MISMATCH"):
            validate_document(self.png, "example.pdf", "application/pdf")

    def test_hash_mismatch_rejected(self):
        with self.assertRaisesRegex(InvalidDocument, "DOCUMENT_HASH_MISMATCH"):
            validate_document(self.png, "example.png", "image/png", "0" * 64)

    def test_corrupt_image_rejected_after_magic_bytes(self):
        with self.assertRaisesRegex(InvalidDocument, "DOCUMENT_IMAGE_CORRUPT"):
            validate_document(b"\x89PNG\r\n\x1a\n" + b"broken", "example.png", "image/png")

    def test_file_size_enforced(self):
        with self.assertRaisesRegex(InvalidDocument, "DOCUMENT_SIZE_INVALID"):
            validate_document(b"", "example.png", "image/png")

    def test_pdf_page_count_enforced(self):
        import pymupdf
        pdf = pymupdf.open()
        for _ in range(9): pdf.new_page()
        with self.assertRaisesRegex(InvalidDocument, "DOCUMENT_PDF_PAGE_LIMIT"):
            validate_document(pdf.tobytes(), "example.pdf", "application/pdf")
        pdf.close()

    def test_native_pdf_page_and_scanned_page_use_separate_paths(self):
        import pymupdf

        class StubProvider:
            name = "synthetic-test"
            version = "1"

            def recognize(self, _image):
                return "SCAN-001", [], 0.9

        pdf = pymupdf.open()
        native = pdf.new_page()
        native.insert_text((40, 70), "Native text invoice number TEST-001 with sufficient readable text", fontsize=12)
        scanned = pdf.new_page()
        scanned.insert_image(scanned.rect, stream=self.png)
        result = process_document(pdf.tobytes(), "mixed.pdf", "application/pdf", StubProvider())
        pdf.close()
        self.assertEqual(len(result["pages"]), 2)
        self.assertEqual(result["pages"][0]["method"], "native_pdf")
        self.assertIn("TEST-001", result["pages"][0]["text"])
        self.assertEqual(result["pages"][1]["method"], "ocr")
        self.assertEqual(result["pages"][1]["text"], "SCAN-001")


class ClaimOcrRecoveryTests(unittest.TestCase):
    def test_latin_reference_requires_same_row_and_high_confidence(self):
        provider = PaddleProvider.__new__(PaddleProvider)
        provider._pipeline = FakePipeline(["رقم المطالبة", "شركة التأمين تجريبية"], [.91, .85], [100, 200])
        provider._english_pipeline = FakePipeline(
            ["C/004/01/26/9999/00001", "C/004/01/26/8888/00001", "C/004/01/26/7777/00001"],
            [.97, .99, .40], [100, 300, 100])
        text, segments, _ = provider.recognize(None)
        self.assertIn("C/004/01/26/9999/00001", text)
        self.assertNotIn("C/004/01/26/8888/00001", text)
        self.assertNotIn("C/004/01/26/7777/00001", text)
        self.assertEqual(len(segments), 3)

    def test_no_unrelated_latin_reference_is_promoted_without_claim_label(self):
        provider = PaddleProvider.__new__(PaddleProvider)
        provider._pipeline = FakePipeline(["فاتورة ضريبية"], [.9], [100])
        provider._english_pipeline = FakePipeline(["C/004/01/26/9999/00001"], [.98], [100])
        text, _, _ = provider.recognize(None)
        self.assertEqual(text, "فاتورة ضريبية")

    def test_numeric_crop_accepts_complete_plate_but_not_guessed_date(self):
        import numpy as np
        provider = PaddleProvider.__new__(PaddleProvider)
        provider._pipeline = SequencePipeline(
            FakePipeline(["رقم اللوحة٤", "تاريخ الحادث٤"], [.8, .8], [100, 220]),
            FakePipeline(["٤٧٧٨٢"], [.75], [10]),
            FakePipeline(["٢٧١٠٤١٢٠٢٦"], [.9], [10]),
            FakePipeline(["٢٧١٠٤١٢٠٢٦"], [.9], [10]),
            FakePipeline(["٢٧١٠٤١٢٠٢٦"], [.9], [10]),
            FakePipeline(["٢٧١٠٤١٢٠٢٦"], [.9], [10]),
        )
        provider._english_pipeline = None
        text, _, _ = provider.recognize(np.zeros((500, 1000, 3), dtype=np.uint8))
        self.assertIn("٤٧٧٨٢", text)
        self.assertNotIn("٢٧١٠٤١٢٠٢٦", text)
        self.assertEqual(provider._pipeline.calls, 6)

    def test_compact_date_requires_two_agreeing_crops_and_valid_calendar_day(self):
        import numpy as np
        provider = PaddleProvider.__new__(PaddleProvider)
        provider._pipeline = SequencePipeline(
            FakePipeline(["تاريخ الحادث٤"], [.8], [220]),
            FakePipeline(["٢٧١٠٤١٢٠٢٦"], [.9], [10]),
            FakePipeline(["٢٧٠٤٢٠٢٦"], [.85], [10]),
            FakePipeline(["٢٧١٠٤١٢٠٢٦"], [.9], [10]),
            FakePipeline(["٢٧٠٤٢٠٢٦"], [.81], [10]),
        )
        provider._english_pipeline = None
        text, _, _ = provider.recognize(np.zeros((500, 1000, 3), dtype=np.uint8))
        self.assertIn("٢٧٠٤٢٠٢٦", text)
        self.assertNotIn("٢٧١٠٤١٢٠٢٦", text)

    def test_partial_inline_plate_can_be_recovered_but_complete_value_is_not_recropped(self):
        import numpy as np
        provider = PaddleProvider.__new__(PaddleProvider)
        provider._pipeline = SequencePipeline(
            FakePipeline(["رقم اللوحة٤٢"], [.8], [100]),
            FakePipeline(["٤٧٧٨٢"], [.75], [10]),
        )
        provider._english_pipeline = None
        text, _, _ = provider.recognize(np.zeros((300, 1000, 3), dtype=np.uint8))
        self.assertIn("٤٧٧٨٢", text)
        self.assertEqual(provider._pipeline.calls, 2)

        provider._pipeline = SequencePipeline(FakePipeline(["رقم اللوحة٤٧٧٨٢"], [.9], [100]))
        text, _, _ = provider.recognize(np.zeros((300, 1000, 3), dtype=np.uint8))
        self.assertEqual(text, "رقم اللوحة٤٧٧٨٢")
        self.assertEqual(provider._pipeline.calls, 1)


if __name__ == "__main__":
    unittest.main()
