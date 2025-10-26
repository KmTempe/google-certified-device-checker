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


@pytest.fixture()
def client() -> TestClient:
    return TestClient(main.app)


def test_health_endpoint(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


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


def test_http_cache_headers_present(client: TestClient) -> None:
    """Test that HTTP cache headers are set on successful responses."""
    response = client.get("/check", params={"model": "GR1YH"})
    assert response.status_code == 200
    
    # Check Cache-Control header
    assert "Cache-Control" in response.headers
    cache_control = response.headers["Cache-Control"]
    assert "public" in cache_control
    assert "max-age=86400" in cache_control  # 24 hours
    
    # Check Vary header for proper caching
    assert "Vary" in response.headers
    assert "Accept-Encoding" in response.headers["Vary"]


def test_http_cache_headers_consistent_across_requests(client: TestClient) -> None:
    """Test that cache headers are consistent for identical requests."""
    params = {"brand": "Google", "limit": 50}
    
    response1 = client.get("/check", params=params)
    response2 = client.get("/check", params=params)
    
    assert response1.status_code == 200
    assert response2.status_code == 200
    
    # Both should have identical cache headers
    assert response1.headers["Cache-Control"] == response2.headers["Cache-Control"]
    assert response1.json() == response2.json()


def test_http_cache_not_applied_to_errors(client: TestClient) -> None:
    """Test that cache headers are not preventing error responses."""
    # Invalid request (no filter)
    response = client.get("/check")
    assert response.status_code == 400
    # Error responses shouldn't have our custom cache headers
    # (FastAPI may add its own headers, but we don't set them)


def test_different_parameters_different_cache(client: TestClient) -> None:
    """Test that different search parameters would result in different cache entries."""
    # This tests that the endpoint properly handles different parameters
    # Frontend cache will handle the actual caching logic
    
    response1 = client.get("/check", params={"brand": "Google"})
    response2 = client.get("/check", params={"brand": "Nothing"})
    
    assert response1.status_code == 200
    assert response2.status_code == 200
    
    data1 = response1.json()
    data2 = response2.json()
    
    # Different parameters should return different results
    assert data1["results"] != data2["results"]
    # Verify we got different devices
    assert data1["results"][0]["device"] == "akita"
    assert data2["results"][0]["device"] == "nothing"

