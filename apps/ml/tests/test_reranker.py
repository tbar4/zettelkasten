"""Tests for the MLP re-ranker.

Run with: cd apps/ml && pytest tests/test_reranker.py
"""

from __future__ import annotations

import os
import copy
import tempfile

import pytest


# ---------------------------------------------------------------------------
# Unit tests for Reranker class
# ---------------------------------------------------------------------------


def test_score_returns_values_in_unit_interval():
    """score() output should be in [0, 1] for any input."""
    from src.reranker import Reranker

    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "reranker.pt")
        r = Reranker(model_path=path)

        features = [
            [0.8, 3, 1, 1, 0.9],
            [0.1, 0, 0, 0, 0.05],
            [0.5, 1, 1, 0, 0.5],
        ]
        scores = r.score(features)

        assert len(scores) == 3
        for s in scores:
            assert 0.0 <= s <= 1.0, f"Score {s} out of [0, 1]"


def test_score_empty_returns_empty():
    """score([]) should return []."""
    from src.reranker import Reranker

    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "reranker.pt")
        r = Reranker(model_path=path)
        assert r.score([]) == []


def test_train_step_changes_weights():
    """After train_step, model parameters should differ from initial state."""
    from src.reranker import Reranker
    import torch

    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "reranker.pt")
        r = Reranker(model_path=path)

        # Capture initial weights
        before = [p.clone().detach() for p in r._model.parameters()]

        features = [[0.9, 2, 1, 1, 0.8], [0.1, 0, 0, 0, 0.1]]
        labels = [1, 0]
        r.train_step(features, labels)

        after = list(r._model.parameters())

        # At least one parameter tensor should differ
        any_changed = any(
            not torch.equal(b, a.detach()) for b, a in zip(before, after)
        )
        assert any_changed, "No parameters changed after train_step"


def test_train_step_returns_positive_loss():
    """train_step should return a non-negative loss scalar."""
    from src.reranker import Reranker

    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "reranker.pt")
        r = Reranker(model_path=path)

        features = [[0.7, 1, 0, 1, 0.6]]
        labels = [1]
        loss = r.train_step(features, labels)

        assert isinstance(loss, float)
        assert loss >= 0.0


def test_train_step_empty_returns_zero():
    """train_step with empty input should return 0.0."""
    from src.reranker import Reranker

    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "reranker.pt")
        r = Reranker(model_path=path)
        loss = r.train_step([], [])
        assert loss == 0.0


def test_save_and_reload_round_trip():
    """save() + new Reranker(path) should restore the same weights."""
    from src.reranker import Reranker
    import torch

    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "reranker.pt")
        r1 = Reranker(model_path=path)

        # Do a training step to ensure weights differ from default init
        features = [[0.8, 2, 1, 1, 0.9], [0.2, 0, 0, 0, 0.1]]
        labels = [1, 0]
        r1.train_step(features, labels)
        r1.save()

        # Load fresh instance
        r2 = Reranker(model_path=path)

        for p1, p2 in zip(r1._model.parameters(), r2._model.parameters()):
            assert torch.equal(p1.detach(), p2.detach()), "Weights differ after reload"

        # Scores should also match
        scores1 = r1.score(features)
        scores2 = r2.score(features)
        assert scores1 == pytest.approx(scores2, abs=1e-6)


# ---------------------------------------------------------------------------
# FastAPI endpoint tests
# ---------------------------------------------------------------------------


@pytest.fixture
def patched_reranker(tmp_path, monkeypatch):
    """Fixture that injects a fresh in-memory Reranker into main._reranker."""
    from src.reranker import Reranker
    from src import main

    path = str(tmp_path / "reranker.pt")
    r = Reranker(model_path=path)
    monkeypatch.setattr(main, "_reranker", r)
    return r


@pytest.mark.asyncio
async def test_rerank_endpoint_shape(patched_reranker):
    from httpx import ASGITransport, AsyncClient
    from src import main

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/rerank",
            json={"features": [[0.8, 2, 1, 1, 0.9], [0.2, 0, 0, 0, 0.1]]}
        )

    assert resp.status_code == 200
    data = resp.json()
    assert "scores" in data
    assert len(data["scores"]) == 2
    for s in data["scores"]:
        assert 0.0 <= s <= 1.0


@pytest.mark.asyncio
async def test_rerank_endpoint_empty(patched_reranker):
    from httpx import ASGITransport, AsyncClient
    from src import main

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/rerank", json={"features": []})

    assert resp.status_code == 200
    data = resp.json()
    assert data["scores"] == []


@pytest.mark.asyncio
async def test_train_reranker_endpoint(patched_reranker, tmp_path):
    from httpx import ASGITransport, AsyncClient
    from src import main

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/train-reranker",
            json={
                "features": [[0.9, 3, 1, 1, 0.8], [0.1, 0, 0, 0, 0.05]],
                "labels": [1, 0]
            }
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["trained"] == 2
    assert "loss" in data
    assert data["loss"] >= 0.0
