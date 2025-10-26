from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from typing import Optional

import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

APP_TITLE = "Google Certified Device Checker"
CSV_FILENAME = "supported_devices.csv"
DEFAULT_LIMIT = 50


def _data_path() -> Path:
    return Path(__file__).resolve().parent.parent / CSV_FILENAME


class DeviceRecord(BaseModel):
    retail_branding: str
    marketing_name: str
    device: str
    model: str


class DeviceLookupResponse(BaseModel):
    total_matches: int
    limit: int
    page: int
    total_pages: int
    results: list[DeviceRecord]


@lru_cache(maxsize=1)
def _detect_encoding(path: Path) -> str:
    with path.open("rb") as handle:
        prefix = handle.read(4)
    if prefix.startswith(b"\xff\xfe") or prefix.startswith(b"\xfe\xff"):
        return "utf-16"
    if prefix.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    return "utf-8"


def _load_dataset() -> pd.DataFrame:
    data_path = _data_path()
    if not data_path.exists():
        raise RuntimeError(
            f"Expected CSV dataset at '{data_path}', but the file was not found."
        )

    encoding = _detect_encoding(data_path)
    try:
        df = pd.read_csv(data_path, dtype=str, encoding=encoding).fillna("")
    except UnicodeDecodeError as exc:  # pragma: no cover - defensive only
        raise RuntimeError(
            "Failed to decode CSV. If the file encoding is unusual, convert it to UTF-8."
        ) from exc
    df.columns = [
        "retail_branding",
        "marketing_name",
        "device",
        "model",
    ]

    # Normalize spaces for consistent matching.
    for column in df.columns:
        df[column] = df[column].str.strip()

    return df


def _filter_devices(
    *,
    brand: Optional[str],
    marketing_name: Optional[str],
    device: Optional[str],
    model: Optional[str],
    limit: int,
    page: int,
) -> DeviceLookupResponse:
    if limit <= 0:
        raise HTTPException(status_code=400, detail="limit must be a positive integer")
    if page <= 0:
        raise HTTPException(status_code=400, detail="page must be a positive integer")

    df = _load_dataset()
    mask = pd.Series(True, index=df.index)

    if brand:
        mask &= df["retail_branding"].str.contains(brand, case=False, na=False, regex=False)
    if marketing_name:
        mask &= df["marketing_name"].str.contains(
            marketing_name, case=False, na=False, regex=False
        )
    if device:
        mask &= df["device"].str.contains(device, case=False, na=False, regex=False)
    if model:
        mask &= df["model"].str.contains(model, case=False, na=False, regex=False)

    filtered = df[mask]
    total_matches = int(filtered.shape[0])
    if total_matches == 0:
        total_pages = 0
    else:
        total_pages = int(-(-total_matches // limit))

    offset = (page - 1) * limit
    if offset >= total_matches:
        limited = filtered.iloc[0:0]
    else:
        limited = filtered.iloc[offset : offset + limit]

    results = [
        DeviceRecord(
            retail_branding=str(row.retail_branding),
            marketing_name=str(row.marketing_name),
            device=str(row.device),
            model=str(row.model),
        )
        for row in limited.itertuples()
    ]

    return DeviceLookupResponse(
        total_matches=total_matches,
        limit=limit,
        page=page,
        total_pages=total_pages,
        results=results,
    )


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    try:
        _load_dataset()
    except RuntimeError as exc:
        raise RuntimeError(str(exc)) from exc
    yield
    cache_clear = getattr(_load_dataset, "cache_clear", None)
    if callable(cache_clear):  # pragma: no branch - simple guard
        cache_clear()


# Initialize rate limiter with token bucket algorithm
# 50 requests per 30 minutes with burst allowance of 20 requests per 5 minutes
limiter = Limiter(
    key_func=get_remote_address,
    storage_uri="memory://",
    strategy="moving-window",
)

app = FastAPI(title=APP_TITLE, lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://kmtempe.github.io",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health", tags=["health"])  # pragma: no cover - trivial
async def read_health() -> dict[str, str]:
    return {"status": "ok"}


@app.get(
    "/check",
    response_model=DeviceLookupResponse,
    tags=["devices"],
)
@limiter.limit("200/30minutes;50/5minutes")
async def check_device(
    request: Request,
    brand: Optional[str] = Query(
        None, description="Filter by retail brand (case-insensitive substring match)."
    ),
    marketing_name: Optional[str] = Query(
        None, description="Filter by marketing name (case-insensitive substring match)."
    ),
    device: Optional[str] = Query(
        None, description="Filter by device code (case-insensitive substring match)."
    ),
    model: Optional[str] = Query(
        None, description="Filter by model identifier (case-insensitive substring match)."
    ),
    limit: int = Query(
        DEFAULT_LIMIT,
        gt=0,
        le=500,
        description="Maximum number of matching records to include in the response.",
    ),
    page: int = Query(
        1,
        ge=1,
        description="Page number to return (1-indexed).",
    ),
) -> DeviceLookupResponse:
    if not any([brand, marketing_name, device, model]):
        raise HTTPException(
            status_code=400,
            detail="At least one filter parameter (brand, marketing_name, device, model) is required.",
        )

    return _filter_devices(
        brand=brand,
        marketing_name=marketing_name,
        device=device,
        model=model,
        limit=limit,
        page=page,
    )
