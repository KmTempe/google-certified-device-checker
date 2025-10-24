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
    assert payload["results"][0]["marketing_name"] == "Pixel 9"


def test_check_respects_limit(client: TestClient) -> None:
    response = client.get("/check", params={"brand": "o", "limit": 1})
    assert response.status_code == 200

    payload = response.json()
    assert payload["total_matches"] == 2
    assert len(payload["results"]) == 1
