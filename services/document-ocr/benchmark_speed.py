"""Local Development before/after benchmark on generated synthetic files only.

Runs the real worker process boundary. No database, Storage, credentials or
external AI request is used. OCR pages are retained only for the explicit
synthetic corpus so the application's parser can compare field accuracy.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import multiprocessing
import os
from pathlib import Path
import platform
import sys
import time


def write_receipt(path: Path, receipt: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--mode", choices=("isolated", "warm"), required=True)
    parser.add_argument("--runs", type=int, default=2)
    parser.add_argument("--provider", choices=("paddleocr",), default="paddleocr")
    parser.add_argument("--engine-version", default=None)
    args = parser.parse_args()
    if not 1 <= args.runs <= 5:
        raise SystemExit("DOCUMENT_BENCHMARK_RUN_LIMIT")
    source, dataset = args.source.resolve(), args.dataset.resolve()
    manifest = json.loads((dataset / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("sanitized") is not True or not manifest.get("version", "").startswith("synthetic-"):
        raise SystemExit("DOCUMENT_BENCHMARK_SYNTHETIC_REQUIRED")
    if not 1 <= len(manifest.get("cases", [])) <= 16:
        raise SystemExit("DOCUMENT_BENCHMARK_CASE_LIMIT")
    for case in manifest["cases"]:
        if not (dataset / case["file"]).resolve().is_relative_to(dataset):
            raise SystemExit("DOCUMENT_BENCHMARK_FIXTURE_SCOPE")
    sys.path.insert(0, str(source))
    import worker

    runtime = {}
    for package in ("paddlepaddle", "paddleocr", "PyMuPDF", "Pillow", "opencv-python-headless", "numpy"):
        try:
            runtime[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            runtime[package] = "not installed"
    receipt = {
        "scope": "Development isolated local; generated synthetic fixtures; no hosted operations",
        "sanitized": True, "representative": False, "complete": False,
        "mode": args.mode, "runs": args.runs, "provider": args.provider, "engine_version": args.engine_version,
        "source": str(source), "dataset_version": manifest["version"],
        "python": platform.python_version(), "platform": platform.platform(),
        "runtime": runtime,
        "source_hashes": {name: hashlib.sha256((source / name).read_bytes()).hexdigest()
                          for name in ("ocr_core.py", "worker.py")},
        "cases": [],
        "timing_scope": "wall_ms includes worker spawn/IPC/provider startup/processing; excludes upload, queue wait, matching and field persistence",
    }
    session = worker.WarmOCRProcess(args.provider) if args.mode == "warm" else None
    started_all = time.monotonic()
    try:
        for run in range(1, args.runs + 1):
            for case in manifest["cases"]:
                file = dataset / case["file"]
                raw = file.read_bytes()
                digest = hashlib.sha256(raw).hexdigest()
                job = {"filename": file.name, "mime": case["mime"], "sha256": digest,
                       "tenant_id": "00000000-0000-4000-8000-000000000101"}
                if args.engine_version is not None:
                    job["engine_version"] = args.engine_version
                started = time.monotonic()
                outcome, result = session.process(raw, job) if session else worker.process_isolated(raw, job, args.provider)
                wall_ms = round((time.monotonic() - started) * 1000)
                if outcome != "success" or not isinstance(result, dict):
                    receipt["failed_case"] = {"name": case["name"], "run": run,
                                              "outcome": outcome, "error_code": result if isinstance(result, str) else "INVALID_RESULT"}
                    raise RuntimeError("DOCUMENT_BENCHMARK_OCR_FAILED")
                row = {"name": case["name"], "run": run, "sha256": digest,
                       "wall_ms": wall_ms, "processing_ms": result["duration_ms"],
                       "provider_init_ms": result.get("provider_init_ms"),
                       "total_duration_ms": result.get("total_duration_ms"),
                       "engine": result["engine"], "model_version": result["model_version"],
                       "issues": result.get("issues", []), "pages": result["pages"]}
                receipt["cases"].append(row)
                write_receipt(args.output, receipt)
                print(json.dumps({"mode": args.mode, "case": case["name"], "run": run,
                                  "wall_ms": wall_ms, "pages": len(row["pages"]),
                                  "provider_init_ms": row["provider_init_ms"]}), flush=True)
        receipt["complete"] = True
    finally:
        if session:
            session.close()
        receipt["overall_wall_ms"] = round((time.monotonic() - started_all) * 1000)
        write_receipt(args.output, receipt)


if __name__ == "__main__":
    multiprocessing.freeze_support()
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    main()
