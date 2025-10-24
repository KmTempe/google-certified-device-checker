from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

CSV_URL = "https://storage.googleapis.com/play_public/supported_devices.csv"
REPO_ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = REPO_ROOT / "supported_devices.csv"
META_PATH = CSV_PATH.with_suffix(".meta.json")


def _compute_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _load_metadata() -> dict[str, Any]:
    if META_PATH.exists():
        return json.loads(META_PATH.read_text(encoding="utf-8"))
    if CSV_PATH.exists():
        sha256 = _compute_sha256(CSV_PATH.read_bytes())
        return {"sha256": sha256, "generated_at": datetime.now(timezone.utc).isoformat()}
    return {}


def _save_metadata(metadata: dict[str, Any]) -> None:
    META_PATH.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def refresh_dataset(force: bool = False, timeout: float = 30.0) -> bool:
    metadata = _load_metadata()

    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        head_response = client.head(CSV_URL)
        head_response.raise_for_status()
        etag = head_response.headers.get("ETag")
        last_modified = head_response.headers.get("Last-Modified")

        if etag and metadata.get("etag") == etag and not force:
            print("Dataset already up-to-date (etag match).")
            return False

        response = client.get(CSV_URL)
        response.raise_for_status()
        data = response.content

    sha256 = _compute_sha256(data)
    if metadata.get("sha256") == sha256 and not force:
        print("Dataset already up-to-date (hash match).")
        # Update metadata headers if they changed even when data is same.
        metadata.update({
            "etag": etag,
            "last_modified": last_modified,
            "sha256": sha256,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        })
        _save_metadata(metadata)
        return False

    CSV_PATH.write_bytes(data)

    new_metadata: dict[str, Any] = {
        "source_url": CSV_URL,
        "etag": etag,
        "last_modified": last_modified,
        "sha256": sha256,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "size_bytes": len(data),
    }
    _save_metadata(new_metadata)

    print("Dataset updated. New sha256:", sha256)
    return True


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh Google Play supported devices dataset.")
    parser.add_argument("--force", action="store_true", help="Download dataset even when unchanged.")
    parser.add_argument("--timeout", type=float, default=30.0, help="Request timeout in seconds (default: 30).")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    refresh_dataset(force=args.force, timeout=args.timeout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
