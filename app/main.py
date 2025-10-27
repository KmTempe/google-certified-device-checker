from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from typing import Optional

import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

APP_TITLE = "Google Certified Device Checker"
CSV_FILENAME = "supported_devices.csv"
DEFAULT_LIMIT = 50


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return

    try:
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue

            if "=" not in line:
                continue

            key, value = line.split("=", 1)
            key = key.strip()
            if not key:
                continue

            parsed = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, parsed)
    except OSError:
        # Ignore file access issues to avoid failing app startup when env file is missing.
        return


_load_env_file(Path(__file__).resolve().parent / ".env.local")


def _read_bool_env(name: str, default: bool = False) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    normalized = raw_value.strip().lower()
    return normalized in {"1", "true", "yes", "on"}


def _read_float_env(name: str, default: float = 0.0) -> float:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        return float(raw_value)
    except ValueError:
        return default


RATE_LIMIT_LOG_ENABLED = _read_bool_env("RATE_LIMIT_LOG_ENABLED", default=False)

_rate_limit_logger = logging.getLogger("rate_limit")

if RATE_LIMIT_LOG_ENABLED:
    LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
    LOG_DIR.mkdir(exist_ok=True)
    RATE_LIMIT_LOG = LOG_DIR / "rate_limited_clients.log"

    if not _rate_limit_logger.handlers:
        _rate_limit_logger.setLevel(logging.INFO)
        handler = logging.FileHandler(RATE_LIMIT_LOG)
        handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
        _rate_limit_logger.addHandler(handler)
else:
    if not _rate_limit_logger.handlers:
        _rate_limit_logger.addHandler(logging.NullHandler())


SIMULATE_COLD_START = _read_bool_env("SIMULATE_COLD_START", default=False)
COLD_START_DELAY_SECONDS = max(
    0.0, _read_float_env("COLD_START_DELAY_SECONDS", default=0.0)
)

_cold_start_pending = SIMULATE_COLD_START and COLD_START_DELAY_SECONDS > 0.0
_cold_start_lock: asyncio.Lock | None = None
_cold_start_task: asyncio.Task[None] | None = None


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


async def _complete_cold_start() -> None:
    global _cold_start_pending, _cold_start_task
    try:
        await asyncio.sleep(COLD_START_DELAY_SECONDS)
        _cold_start_pending = False
    finally:
        _cold_start_task = None


async def _ensure_service_ready() -> None:
    global _cold_start_lock, _cold_start_task
    if not _cold_start_pending:
        return

    if _cold_start_lock is None:
        _cold_start_lock = asyncio.Lock()

    async with _cold_start_lock:
        if not _cold_start_pending:
            return

        if _cold_start_task is None:
            _cold_start_task = asyncio.create_task(_complete_cold_start())

        retry_after = max(1, int(COLD_START_DELAY_SECONDS)) if COLD_START_DELAY_SECONDS else 1
        raise HTTPException(
            status_code=503,
            detail="Service is warming up. Please retry shortly.",
            headers={"Retry-After": str(retry_after)},
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


# Initialize rate limiter


def _client_identifier(request: Request) -> str:
    """Return a stable client identifier taking reverse proxies into account."""
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        for part in forwarded_for.split(","):
            ip = part.strip()
            if ip:
                return ip

    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()

    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip:
        return cf_ip.strip()

    client = request.client
    if client and client.host:
        return client.host

    return "unknown"


limiter = Limiter(key_func=_client_identifier, headers_enabled=True)

app = FastAPI(title=APP_TITLE, lifespan=lifespan)
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)


async def _log_rate_limit_exceeded(request: Request, exc: RateLimitExceeded):
    client_id = _client_identifier(request)
    route = request.url.path
    if RATE_LIMIT_LOG_ENABLED:
        _rate_limit_logger.info("blocked client=%s route=%s", client_id, route)
    return _rate_limit_exceeded_handler(request, exc)


app.add_exception_handler(RateLimitExceeded, _log_rate_limit_exceeded)  # type: ignore[arg-type]

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
    status = "initializing" if _cold_start_pending else "ok"
    return {"status": status}


@app.get(
    "/check",
    response_model=DeviceLookupResponse,
    tags=["devices"],
)
@limiter.limit("200/30minutes;50/5minutes")
async def check_device(
    request: Request,
    response: Response,
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
    await _ensure_service_ready()

    if not any([brand, marketing_name, device, model]):
        raise HTTPException(
            status_code=400,
            detail="At least one filter parameter (brand, marketing_name, device, model) is required.",
        )

    # Add HTTP cache headers (24 hours since dataset updates daily)
    response.headers["Cache-Control"] = "public, max-age=86400"
    response.headers["Vary"] = "Accept-Encoding"

    return _filter_devices(
        brand=brand,
        marketing_name=marketing_name,
        device=device,
        model=model,
        limit=limit,
        page=page,
    )
