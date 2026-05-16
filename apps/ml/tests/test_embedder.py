"""Tests for the embedder and FastAPI endpoint.

These tests monkeypatch SentenceTransformerModel so no model download is needed.
Run with: cd apps/ml && pytest
"""

from __future__ import annotations

import os
import pytest

# ---------------------------------------------------------------------------
# Fake model stub
# ---------------------------------------------------------------------------


class FakeModel:
    """Returns deterministic vectors of length 768 based on text length."""

    def encode(self, texts: list[str]) -> list[list[float]]:
        vectors = []
        for text in texts:
            # Deterministic: use ord of each char mod 1.0, padded/truncated to 768
            base = [ord(c) / 1000.0 for c in text[:768]]
            vec = base + [0.0] * (768 - len(base))
            vectors.append(vec)
        return vectors


# ---------------------------------------------------------------------------
# Unit tests for embedder.py
# ---------------------------------------------------------------------------


def test_embed_empty():
    from src.embedder import embed

    vectors, model_version = embed([], model=FakeModel())  # type: ignore[arg-type]
    assert vectors == []
    assert model_version == "nomic-ai/nomic-embed-text-v1.5"


def test_embed_single(monkeypatch):
    from src import embedder

    vectors, model_version = embedder.embed(["hello world"], model=FakeModel())  # type: ignore[arg-type]

    assert len(vectors) == 1
    assert len(vectors[0]) == 768
    assert model_version == "nomic-ai/nomic-embed-text-v1.5"


def test_embed_multiple(monkeypatch):
    from src import embedder

    texts = ["first text", "second text", "third text"]
    vectors, _ = embedder.embed(texts, model=FakeModel())  # type: ignore[arg-type]

    assert len(vectors) == 3
    for vec in vectors:
        assert len(vec) == 768

    # Vectors should be different for different texts
    assert vectors[0] != vectors[1]


def test_embed_deterministic():
    from src import embedder

    text = "consistent input"
    v1, _ = embedder.embed([text], model=FakeModel())  # type: ignore[arg-type]
    v2, _ = embedder.embed([text], model=FakeModel())  # type: ignore[arg-type]
    assert v1 == v2


# ---------------------------------------------------------------------------
# FastAPI endpoint tests (async, using pytest-asyncio + httpx ASGI transport)
# ---------------------------------------------------------------------------


@pytest.fixture
def patched_embed(monkeypatch):
    """Fixture that patches the embed function in main with FakeModel."""
    from src import embedder, main

    fake = FakeModel()
    original_embed = embedder.embed

    def _patched(texts, *, model=None):
        return original_embed(texts, model=fake)  # type: ignore[arg-type]

    monkeypatch.setattr(main, "_embed", _patched)


@pytest.mark.asyncio
async def test_health(patched_embed):
    from httpx import ASGITransport, AsyncClient
    from src import main

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_embed_endpoint_shape(patched_embed):
    from httpx import ASGITransport, AsyncClient
    from src import main

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/embed", json={"texts": ["hello", "world"]})
    assert resp.status_code == 200
    data = resp.json()
    assert "vectors" in data
    assert "modelVersion" in data
    assert len(data["vectors"]) == 2
    assert len(data["vectors"][0]) == 768
    assert data["modelVersion"] == "nomic-ai/nomic-embed-text-v1.5"


@pytest.mark.asyncio
async def test_embed_endpoint_empty(patched_embed):
    from httpx import ASGITransport, AsyncClient
    from src import main

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/embed", json={"texts": []})
    assert resp.status_code == 200
    data = resp.json()
    assert data["vectors"] == []
