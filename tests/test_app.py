from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import main


@pytest.fixture(autouse=True)
def override_dataset(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[None]:
    csv_content = (
        "Retail Branding,Marketing Name,Device,Model\n"
        "Google,Pixel 9,akita,GR1YH\n"
        "Nothing,Phone (2),nothing,AIN142\n"
    )
    mock_path = tmp_path / "supported_devices.csv"
    mock_path.write_text(csv_content, encoding="utf-8")

    cache_clear = getattr(main._load_dataset, "cache_clear", lambda: None)
    cache_clear()
    monkeypatch.setattr(main, "_data_path", lambda: mock_path)
    yield
    cache_clear()


@pytest.fixture(autouse=True)
def disable_cold_start(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Ensure tests start with service ready even if env enables cold start."""
    monkeypatch.setattr(main, "_cold_start_pending", False)
    monkeypatch.setattr(main, "_cold_start_task", None)
    monkeypatch.setattr(main, "_cold_start_lock", None)
    yield


@pytest.fixture()
def client() -> Iterator[TestClient]:
    main.limiter.reset()
    with TestClient(main.app) as test_client:
        yield test_client
    main.limiter.reset()


def test_health_endpoint(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_reports_initializing_when_cold_start(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    monkeypatch.setattr(main, "_cold_start_pending", True)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "initializing"}


def test_check_requires_filter(client: TestClient) -> None:
    response = client.get("/check")
    assert response.status_code == 400
    assert "At least one filter" in response.json()["detail"]


def test_check_filters_results(client: TestClient) -> None:
    response = client.get("/check", params={"brand": "Google"})
    assert response.status_code == 200

    payload = response.json()
    assert payload["total_matches"] == 1
    assert payload["page"] == 1
    assert payload["total_pages"] == 1
    assert payload["results"][0]["marketing_name"] == "Pixel 9"


def test_check_respects_limit(client: TestClient) -> None:
    response = client.get("/check", params={"brand": "o", "limit": 1})
    assert response.status_code == 200

    payload = response.json()
    assert payload["total_matches"] == 2
    assert payload["limit"] == 1
    assert payload["page"] == 1
    assert payload["total_pages"] == 2
    assert len(payload["results"]) == 1


def test_check_pagination_second_page(client: TestClient) -> None:
    response = client.get("/check", params={"brand": "o", "limit": 1, "page": 2})
    assert response.status_code == 200

    payload = response.json()
    assert payload["total_matches"] == 2
    assert payload["limit"] == 1
    assert payload["page"] == 2
    assert payload["total_pages"] == 2
    assert len(payload["results"]) == 1
    assert payload["results"][0]["marketing_name"] == "Phone (2)"


def test_rate_limit_allows_multiple_requests(client: TestClient) -> None:
    """Test that multiple requests within rate limit succeed."""
    # Make several requests well under the 100/hour limit
    # In test mode, rate limiting is in-memory and should allow these
    for _ in range(5):
        response = client.get("/check", params={"brand": "Google"})
        assert response.status_code == 200
        payload = response.json()
        assert payload["total_matches"] == 1


def test_rate_limit_blocks_after_threshold(client: TestClient) -> None:
    """Rate limiter should return 429 once the hourly quota is exceeded."""
    for _ in range(100):
        ok_response = client.get("/check", params={"brand": "Google"})
        assert ok_response.status_code == 200

    blocked_response = client.get("/check", params={"brand": "Google"})
    assert blocked_response.status_code == 429


def test_rate_limit_uses_forwarded_for_header(client: TestClient) -> None:
    """Ensure X-Forwarded-For is honoured when computing the rate-limit key."""
    headers = {"x-forwarded-for": "203.0.113.5"}
    for _ in range(100):
        ok_response = client.get("/check", params={"brand": "Google"}, headers=headers)
        assert ok_response.status_code == 200

    blocked_response = client.get(
        "/check", params={"brand": "Google"}, headers=headers
    )
    assert blocked_response.status_code == 429


def test_rate_limiter_configured(client: TestClient) -> None:
    """Test that rate limiter is properly configured on the app."""
    # Verify that the app has rate limiter state
    assert hasattr(main.app.state, "limiter")
    assert main.app.state.limiter is not None


def test_cors_allows_configured_origins(client: TestClient) -> None:
    """Test that CORS middleware is configured."""
    
    # Test with production origin
    response = client.get(
        "/check",
        params={"brand": "Google"},
        headers={"Origin": "https://kmtempe.github.io"}
    )
    assert response.status_code == 200
    
    # Test with local dev origin
    response = client.get(
        "/check",
        params={"brand": "Google"},
        headers={"Origin": "http://localhost:5173"}
    )
    assert response.status_code == 200


def test_health_endpoint_always_accessible(client: TestClient) -> None:
    """Test that health endpoint is accessible."""
    for _ in range(10):
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


def test_invalid_page_number(client: TestClient) -> None:
    """Test that invalid page numbers are rejected."""
    response = client.get("/check", params={"brand": "Google", "page": 0})
    assert response.status_code == 422  # Validation error
    
    response = client.get("/check", params={"brand": "Google", "page": -1})
    assert response.status_code == 422


def test_invalid_limit(client: TestClient) -> None:
    """Test that invalid limits are rejected."""
    response = client.get("/check", params={"brand": "Google", "limit": 0})
    assert response.status_code == 422
    
    response = client.get("/check", params={"brand": "Google", "limit": 501})
    assert response.status_code == 422
    
    response = client.get("/check", params={"brand": "Google", "limit": -10})
    assert response.status_code == 422


def test_pagination_with_no_results(client: TestClient) -> None:
    """Test pagination behavior when no results match."""
    response = client.get("/check", params={"brand": "NonExistent", "page": 1})
    assert response.status_code == 200
    
    payload = response.json()
    assert payload["total_matches"] == 0
    assert payload["total_pages"] == 0
    assert len(payload["results"]) == 0


def test_pagination_beyond_available_pages(client: TestClient) -> None:
    """Test requesting a page number beyond available results."""
    response = client.get("/check", params={"brand": "Google", "page": 999})
    assert response.status_code == 200
    
    payload = response.json()
    assert payload["total_matches"] == 1
    assert payload["page"] == 999
    assert len(payload["results"]) == 0  # No results on this page


def test_check_returns_503_during_simulated_cold_start(
    monkeypatch: pytest.MonkeyPatch, client: TestClient
) -> None:
    monkeypatch.setattr(main, "_cold_start_pending", True)
    monkeypatch.setattr(main, "COLD_START_DELAY_SECONDS", 2.0)
    monkeypatch.setattr(main, "_cold_start_lock", None)
    monkeypatch.setattr(main, "_cold_start_task", None)

    response = client.get("/check", params={"brand": "Google"})
    assert response.status_code == 503
    assert "Retry-After" in response.headers

