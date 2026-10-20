import hashlib
import io
import unittest

from PIL import Image

from ocr_core import InvalidDocument, PaddleProvider, _probably_complete_ocr, process_document, validate_document


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

    def test_mixed_pdf_page_keeps_native_header_and_reads_scanned_body(self):
        import pymupdf

        class StubProvider:
            name = "synthetic-test"
            version = "1"

            def recognize(self, _image):
                return "Claim No: C/004/01/26/9999/00001\nPlate No: 47782 B", [], 0.91

        pdf = pymupdf.open()
        page = pdf.new_page()
        page.insert_text((40, 70), "Insurance company selectable heading with more than forty-five characters", fontsize=12)
        page.insert_image(pymupdf.Rect(35, 100, 560, 750), stream=self.png)
        result = process_document(pdf.tobytes(), "mixed.pdf", "application/pdf", StubProvider())
        pdf.close()
        self.assertEqual(result["pages"][0]["method"], "ocr")
        self.assertIn("Insurance company selectable heading", result["pages"][0]["text"])
        self.assertIn("C/004/01/26/9999/00001", result["pages"][0]["text"])

    def test_small_logo_does_not_force_ocr_on_complete_native_page(self):
        import pymupdf

        class NoOcrProvider:
            name = "synthetic-test"
            version = "1"

            def recognize(self, _image):
                raise AssertionError("OCR should not run for a small logo")

        pdf = pymupdf.open()
        page = pdf.new_page()
        page.insert_text((40, 70), "Complete selectable invoice with enough real text to extract safely", fontsize=12)
        page.insert_image(pymupdf.Rect(35, 100, 85, 150), stream=self.png)
        result = process_document(pdf.tobytes(), "native.pdf", "application/pdf", NoOcrProvider())
        pdf.close()
        self.assertEqual(result["pages"][0]["method"], "native_pdf")

    def test_short_confident_fragment_does_not_hide_fuller_ocr_variant(self):
        class VariantProvider:
            name = "synthetic-test"
            version = "1"
            calls = 0

            def recognize(self, _image):
                self.calls += 1
                if self.calls == 1:
                    return "Insurance Claim\nClaim No: C/004/01/26/9999/00001", [], 0.96
                return "Insurance Claim\nClaim No: C/004/01/26/9999/00001\nPlate No: 47782 B\nAccident Date: 27/04/2026\nInsurance Company: Example", [], 0.87

        provider = VariantProvider()
        result = process_document(self.png, "scan.png", "image/png", provider)
        self.assertEqual(provider.calls, 2)
        self.assertIn("Accident Date: 27/04/2026", result["pages"][0]["text"])

    def test_complete_short_claim_does_not_run_expensive_second_variant(self):
        class ClaimProvider:
            name = "synthetic-test"
            version = "1"
            calls = 0

            def recognize(self, _image):
                self.calls += 1
                return "Claim No: C/004/01/26/2510/00545", [
                    {"text": "Claim No: C/004/01/26/2510/00545"},
                    {"text": "Date of Loss: 01/10/2026"},
                    {"text": "Vehicle No: A A/39566"},
                    {"text": "Customer Name: SAMPLE CUSTOMER"},
                    {"text": "Make / Model: Toyota - Land Cruiser"},
                ], .81

            def complete_document(self, segments, confidence):
                return PaddleProvider._english_claim_complete(segments, confidence)

            should_stop_after_variant = PaddleProvider.should_stop_after_variant

        provider = ClaimProvider()
        result = process_document(self.png, "scan.png", "image/png", provider)
        self.assertEqual(provider.calls, 1)
        self.assertEqual(result["pages"][0]["variant"], "original")

    def test_complete_claim_variant_wins_over_longer_boilerplate(self):
        class ClaimProvider:
            name = "synthetic-test"
            version = "1"
            calls = 0
            complete_document = PaddleProvider.complete_document
            should_stop_after_variant = PaddleProvider.should_stop_after_variant

            @staticmethod
            def _english_claim_complete(segments, confidence):
                return PaddleProvider._english_claim_complete(segments, confidence)

            def recognize(self, _image):
                self.calls += 1
                if self.calls == 1:
                    text = "Claim No: C/004/01/26/2510/00545\n" + "Legal terms " * 100
                    return text, [{"text": "Claim No: C/004/01/26/2510/00545"}], .96
                text = "\n".join(("Claim No: C/004/01/26/2510/00545", "Date of Loss: 01/10/2026",
                                  "Vehicle No: A A/39566", "Customer Name: SAMPLE CUSTOMER",
                                  "Make / Model: Toyota - Land Cruiser"))
                return text, [{"text": line} for line in text.splitlines()], .75

        provider = ClaimProvider()
        result = process_document(self.png, "scan.png", "image/png", provider)
        self.assertEqual(provider.calls, 2)
        self.assertEqual(result["pages"][0]["variant"], "local_contrast")
        self.assertIn("Date of Loss: 01/10/2026", result["pages"][0]["text"])

    def test_unreadable_image_is_reported_instead_of_silently_treated_as_complete(self):
        class EmptyProvider:
            name = "synthetic-test"
            version = "1"

            def recognize(self, _image):
                return "", [], 0.0

        result = process_document(self.png, "scan.png", "image/png", EmptyProvider())
        self.assertEqual(result["pages"][0]["text"], "")
        self.assertEqual(result["issues"][0]["code"], "OCR_NO_TEXT")

    def test_long_but_top_only_ocr_does_not_skip_fuller_variant(self):
        class VariantProvider:
            name = "synthetic-test"
            version = "1"
            calls = 0

            def recognize(self, _image):
                self.calls += 1
                if self.calls == 1:
                    return "Claim No: " + "A" * 300, [
                        {"box": {"x": 0, "y": 0, "width": 100, "height": 20}}], 0.95
                return "Claim No: " + "A" * 300 + "\nPlate No: " + "B" * 200, [], 0.84

        provider = VariantProvider()
        result = process_document(self.png, "scan.png", "image/png", provider)
        self.assertEqual(provider.calls, 2)
        self.assertIn("Plate No:", result["pages"][0]["text"])


class ClaimOcrRecoveryTests(unittest.TestCase):
    def test_long_claim_boilerplate_does_not_hide_missing_critical_fields(self):
        provider = PaddleProvider.__new__(PaddleProvider)
        segments = [
            {"text": "Claim No: C/004/01/26/2510/00545", "box": {"x": 30, "y": 30, "width": 400, "height": 25}},
            {"text": "Legal notes " + "document " * 90, "box": {"x": 30, "y": 800, "width": 600, "height": 25}},
        ]
        text = "\n".join(item["text"] for item in segments)
        self.assertTrue(_probably_complete_ocr(text, segments, .96, 1000))
        self.assertFalse(provider.should_stop_after_variant(text, segments, .96, 1000))

    def test_english_gate_pass_uses_english_model_without_arabic_pass_when_complete(self):
        provider = PaddleProvider.__new__(PaddleProvider)
        provider._english_first = True
        provider._english_pipeline = SequencePipeline(FakePipeline([
            "Claim No: C/004/01/26/2510/00545",
            "Date of Loss: 01/10/2026",
            "Vehicle No: A A/39566",
            "Name of Driver, Owner of: AMAL SALIM AL ISMAILI",
            "Vehicle Make & Model: Toyota - Land Cruiser",
        ], [.94] * 5, [100, 150, 200, 250, 300]))
        provider._pipeline = SequencePipeline(FakePipeline(["لا ينبغي تشغيل النموذج العربي"], [.9], [100]))
        text, _, _ = provider.recognize(None)
        self.assertIn("AMAL SALIM AL ISMAILI", text)
        self.assertEqual(provider._english_pipeline.calls, 1)
        self.assertEqual(provider._pipeline.calls, 0)

    def test_issue_date_does_not_substitute_for_missing_loss_date(self):
        english = [
            {"text": "Claim No: C/004/01/26/2510/00545", "box": {"x": 50, "y": 100, "width": 450, "height": 30}},
            {"text": "Date: 08/10/2026", "box": {"x": 700, "y": 30, "width": 280, "height": 30}},
            {"text": "Date of Loss", "box": {"x": 50, "y": 300, "width": 170, "height": 30}},
            {"text": "Vehicle No: A A/39566", "box": {"x": 50, "y": 200, "width": 300, "height": 30}},
            {"text": "Customer Name: SAMPLE CUSTOMER", "box": {"x": 50, "y": 250, "width": 480, "height": 30}},
            {"text": "Make / Model: Toyota - Land Cruiser", "box": {"x": 50, "y": 350, "width": 480, "height": 30}},
        ]
        self.assertFalse(PaddleProvider._english_claim_complete(english, .95))
        english.append({"text": "01/10/2026", "box": {"x": 320, "y": 301, "width": 150, "height": 30}})
        self.assertTrue(PaddleProvider._english_claim_complete(english, .95))

    def test_intimation_date_on_same_row_cannot_satisfy_missing_loss_date(self):
        segments = [
            {"text": "Date of Loss", "box": {"x": 50, "y": 100, "width": 160, "height": 28}},
            {"text": "Date of Intimation", "box": {"x": 420, "y": 100, "width": 230, "height": 28}},
            {"text": "05/10/2026", "box": {"x": 700, "y": 100, "width": 155, "height": 28}},
        ]
        self.assertFalse(PaddleProvider._labeled_value(segments, r"date\s+of\s+loss", r"\b\d{1,2}/\d{1,2}/\d{4}\b"))
        self.assertFalse(PaddleProvider._labeled_value([
            {"text": "Date of Loss / Date of Intimation: 05/10/2026"},
        ], r"date\s+of\s+loss", r"\b\d{1,2}/\d{1,2}/\d{4}\b"))

    def test_incomplete_english_page_falls_back_to_existing_arabic_model(self):
        provider = PaddleProvider.__new__(PaddleProvider)
        provider._english_first = True
        provider._english_pipeline = SequencePipeline(FakePipeline(
            ["Claim No: C/004/01/26/2510/00545"], [.76], [100]))
        provider._pipeline = SequencePipeline(FakePipeline([
            "رقم المطالبة C/004/01/26/2510/00545", "تاريخ الحادث: 01/10/2026",
            "رقم اللوحة: 39566", "اسم المالك: عميل تجريبي",
        ], [.94] * 4, [100, 200, 300, 400]))
        text, _, _ = provider.recognize(None)
        self.assertIn("تاريخ الحادث", text)
        self.assertEqual(provider._english_pipeline.calls, 1)
        self.assertEqual(provider._pipeline.calls, 1)

    def test_missing_english_loss_date_is_reread_only_on_its_printed_row(self):
        import numpy as np
        provider = PaddleProvider.__new__(PaddleProvider)
        provider._english_first = True
        provider._english_pipeline = SequencePipeline(
            FakePipeline([
                "Claim No: C/004/01/26/2510/00545", "Date of Loss",
                "Vehicle No: A A/39566", "Customer Name: SAMPLE CUSTOMER",
                "Make / Model: Toyota - Land Cruiser",
            ], [.93] * 5, [100, 150, 200, 250, 300]),
            FakePipeline(["Date of Loss: 01/10/2026"], [.95], [10]),
        )
        provider._pipeline = SequencePipeline(FakePipeline(["لا حاجة لإعادة قراءة العربية"], [.9], [100]))
        text, _, _ = provider.recognize(np.zeros((500, 1000, 3), dtype=np.uint8))
        self.assertIn("Date of Loss: 01/10/2026", text)
        self.assertEqual(provider._english_pipeline.calls, 2)
        self.assertEqual(provider._pipeline.calls, 0)

    def test_vehicle_year_is_recovered_only_from_its_own_gate_pass_row(self):
        import numpy as np
        provider = PaddleProvider.__new__(PaddleProvider)
        provider._pipeline = SequencePipeline(
            FakePipeline(["Vehicle Make & Model", "21السنة"], [.97, .87], [100, 100]),
            FakePipeline(["السنة", "2021"], [.93, .99], [10, 10]),
        )
        provider._english_pipeline = None
        text, segments, _ = provider.recognize(np.zeros((500, 1000, 3), dtype=np.uint8))
        self.assertIn("2021", text)
        self.assertEqual(provider._pipeline.calls, 2)
        self.assertEqual(next(item for item in segments if item["text"] == "2021")["confidence"], .99)

    def test_vehicle_year_recovery_does_not_borrow_unrelated_date_or_weak_digit(self):
        import numpy as np
        provider = PaddleProvider.__new__(PaddleProvider)
        provider._pipeline = SequencePipeline(
            FakePipeline(["Date of Loss", "21السنة"], [.97, .87], [100, 100]),
        )
        provider._english_pipeline = None
        text, _, _ = provider.recognize(np.zeros((500, 1000, 3), dtype=np.uint8))
        self.assertNotIn("2021", text)
        self.assertEqual(provider._pipeline.calls, 1)

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
