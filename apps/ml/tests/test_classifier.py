"""Tests for the XGBoost highlight promotion classifier.

Run with: cd apps/ml && pytest tests/test_classifier.py
"""

from __future__ import annotations

import os
import tempfile

import pytest


# ---------------------------------------------------------------------------
# Unit tests for Classifier class
# ---------------------------------------------------------------------------


def test_score_returns_half_when_no_model():
    """Without a trained model, score() should return 0.5 for each row."""
    from src.classifier import Classifier

    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "classifier.pkl")
        clf = Classifier(model_path=path)

        features = [
            [0.4, 1.0, 0.3, 0.7, 0.5],
            [0.1, 0.0, 0.1, 0.3, 0.8],
        ]
        scores = clf.score(features)
        assert scores == [0.5, 0.5]


def test_score_empty_returns_empty():
    """score([]) should return []."""
    from src.classifier import Classifier

    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "classifier.pkl")
        clf = Classifier(model_path=path)
        assert clf.score([]) == []


def test_train_noop_below_threshold():
    """train() with fewer than MIN_TRAINING_EVENTS rows must be a no-op."""
    from src.classifier import Classifier, MIN_TRAINING_EVENTS

    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "classifier.pkl")
        clf = Classifier(model_path=path)

        # Provide only 10 rows — below the 50-event gate
        features = [[float(i), 0.5, 0.3, 0.7, 0.5] for i in range(10)]
        labels = [i % 2 for i in range(10)]
        clf.train(features, labels)

        # Model file must NOT exist
        assert not os.path.exists(path), "Model file should not be written below threshold"
        # Model must still be None
        assert clf._model is None


def test_train_produces_model_above_threshold():
    """train() with >= MIN_TRAINING_EVENTS rows should persist a model."""
    from src.classifier import Classifier, MIN_TRAINING_EVENTS

    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "classifier.pkl")
        clf = Classifier(model_path=path)

        n = MIN_TRAINING_EVENTS
        features = [[float(i % 5) * 0.1, float(i % 2), 0.3, 0.7, 0.5] for i in range(n)]
        labels = [i % 2 for i in range(n)]
        clf.train(features, labels)

        assert os.path.exists(path), "Model file should exist after training"
        assert clf._model is not None


def test_score_after_train_in_unit_interval():
    """After training, score() should return values in [0, 1]."""
    from src.classifier import Classifier, MIN_TRAINING_EVENTS

    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "classifier.pkl")
        clf = Classifier(model_path=path)

        n = MIN_TRAINING_EVENTS
        features = [[float(i % 5) * 0.15, float(i % 2), 0.3, 0.7, (i % 24) / 24] for i in range(n)]
        labels = [i % 2 for i in range(n)]
        clf.train(features, labels)

        test_features = [
            [0.4, 1.0, 0.7, 0.7, 0.5],
            [0.05, 0.0, 0.1, 0.3, 0.9],
        ]
        scores = clf.score(test_features)
        assert len(scores) == 2
        for s in scores:
            assert 0.0 <= s <= 1.0, f"Score {s} out of [0, 1]"


def test_reload_model_from_disk():
    """A new Classifier instance loading a saved model should produce same scores."""
    from src.classifier import Classifier, MIN_TRAINING_EVENTS

    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "classifier.pkl")

        # Train and save
        clf1 = Classifier(model_path=path)
        n = MIN_TRAINING_EVENTS
        features = [[float(i % 5) * 0.15, float(i % 2), 0.3, 0.7, (i % 24) / 24] for i in range(n)]
        labels = [i % 2 for i in range(n)]
        clf1.train(features, labels)

        # Reload from disk
        clf2 = Classifier(model_path=path)
        assert clf2._model is not None

        test_feat = [[0.4, 1.0, 0.7, 0.7, 0.5]]
        s1 = clf1.score(test_feat)
        s2 = clf2.score(test_feat)
        assert abs(s1[0] - s2[0]) < 1e-6, f"Scores differ after reload: {s1} vs {s2}"


def test_color_score_mapping():
    """color_score() should return expected values per color string."""
    from src.classifier import color_score

    assert color_score("yellow") == pytest.approx(0.3)
    assert color_score("blue") == pytest.approx(0.5)
    assert color_score("pink") == pytest.approx(0.7)
    assert color_score("green") == pytest.approx(0.9)
    assert color_score(None) == pytest.approx(0.1)
    assert color_score("unknown") == pytest.approx(0.1)


def test_source_type_score_mapping():
    """source_type_score() should return expected values."""
    from src.classifier import source_type_score

    assert source_type_score("book") == pytest.approx(0.7)
    assert source_type_score("article") == pytest.approx(0.5)
    assert source_type_score(None) == pytest.approx(0.3)
    assert source_type_score("podcast") == pytest.approx(0.3)


# ---------------------------------------------------------------------------
# FastAPI endpoint tests
# ---------------------------------------------------------------------------


@pytest.fixture
def patched_classifier(tmp_path, monkeypatch):
    """Inject a fresh in-memory Classifier into main._classifier."""
    from src.classifier import Classifier
    from src import main

    path = str(tmp_path / "classifier.pkl")
    clf = Classifier(model_path=path)
    monkeypatch.setattr(main, "_classifier", clf)
    return clf


@pytest.mark.asyncio
async def test_score_highlights_endpoint_cold_start(patched_classifier):
    """Without a model, /score-highlights should return 0.5 per row."""
    from httpx import ASGITransport, AsyncClient
    from src import main

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/score-highlights",
            json={"features": [[0.4, 1.0, 0.3, 0.7, 0.5], [0.1, 0.0, 0.1, 0.3, 0.8]]}
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["scores"] == [0.5, 0.5]


@pytest.mark.asyncio
async def test_score_highlights_endpoint_empty(patched_classifier):
    """Empty feature list should return empty scores."""
    from httpx import ASGITransport, AsyncClient
    from src import main

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/score-highlights", json={"features": []})

    assert resp.status_code == 200
    assert resp.json()["scores"] == []


@pytest.mark.asyncio
async def test_train_classifier_endpoint_noop_below_threshold(patched_classifier):
    """train-classifier with < 50 events should return noop=True."""
    from httpx import ASGITransport, AsyncClient
    from src import main

    transport = ASGITransport(app=main.app)
    features = [[0.4, 1.0, 0.3, 0.7, 0.5] for _ in range(10)]
    labels = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1]

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/train-classifier",
            json={"features": features, "labels": labels}
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["noop"] is True
    assert data["trained"] == 0


@pytest.mark.asyncio
async def test_train_classifier_endpoint_trains(patched_classifier):
    """train-classifier with >= 50 events should return noop=False and trained count."""
    from httpx import ASGITransport, AsyncClient
    from src import main
    from src.classifier import MIN_TRAINING_EVENTS

    transport = ASGITransport(app=main.app)
    n = MIN_TRAINING_EVENTS
    features = [[float(i % 5) * 0.15, float(i % 2), 0.3, 0.7, (i % 24) / 24] for i in range(n)]
    labels = [i % 2 for i in range(n)]

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/train-classifier",
            json={"features": features, "labels": labels}
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["noop"] is False
    assert data["trained"] == n
