"""FastAPI ML service — text embedding + re-ranking + highlight classification."""

from __future__ import annotations

import os

from fastapi import FastAPI
from pydantic import BaseModel

from .embedder import embed as _embed
from .reranker import Reranker
from .classifier import Classifier

app = FastAPI(title="Zettelkasten ML Service", version="0.1.0")

# ---------------------------------------------------------------------------
# Lazy singletons
# ---------------------------------------------------------------------------

_reranker: Reranker | None = None

def _get_reranker() -> Reranker:
    global _reranker
    if _reranker is None:
        model_path = os.environ.get(
            "RERANKER_MODEL_PATH",
            os.path.join(os.path.dirname(__file__), "..", "data", "reranker.pt"),
        )
        _reranker = Reranker(model_path=model_path)
    return _reranker


_classifier: Classifier | None = None

def _get_classifier() -> Classifier:
    global _classifier
    if _classifier is None:
        model_path = os.environ.get(
            "CLASSIFIER_MODEL_PATH",
            os.path.join(os.path.dirname(__file__), "..", "data", "classifier.pkl"),
        )
        _classifier = Classifier(model_path=model_path)
    return _classifier


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class EmbedRequest(BaseModel):
    texts: list[str]


class EmbedResponse(BaseModel):
    vectors: list[list[float]]
    modelVersion: str


class RerankRequest(BaseModel):
    features: list[list[float]]


class RerankResponse(BaseModel):
    scores: list[float]


class TrainRequest(BaseModel):
    features: list[list[float]]
    labels: list[int]


class TrainResponse(BaseModel):
    trained: int
    loss: float


class ScoreHighlightsRequest(BaseModel):
    features: list[list[float]]


class ScoreHighlightsResponse(BaseModel):
    scores: list[float]


class TrainClassifierRequest(BaseModel):
    features: list[list[float]]
    labels: list[int]


class TrainClassifierResponse(BaseModel):
    trained: int
    noop: bool


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/embed", response_model=EmbedResponse)
async def embed(req: EmbedRequest) -> EmbedResponse:
    """Embed a list of texts and return 768-dim vectors."""
    vectors, model_version = _embed(req.texts)
    return EmbedResponse(vectors=vectors, modelVersion=model_version)


@app.post("/rerank", response_model=RerankResponse)
async def rerank(req: RerankRequest) -> RerankResponse:
    """Score a batch of 5-dim feature vectors. Returns a score in [0,1] per row."""
    reranker = _get_reranker()
    scores = reranker.score(req.features)
    return RerankResponse(scores=scores)


@app.post("/train-reranker", response_model=TrainResponse)
async def train_reranker(req: TrainRequest) -> TrainResponse:
    """Run one mini-batch SGD step and persist the updated model."""
    reranker = _get_reranker()
    loss = reranker.train_step(req.features, req.labels)
    reranker.save()
    return TrainResponse(trained=len(req.features), loss=loss)


@app.post("/score-highlights", response_model=ScoreHighlightsResponse)
async def score_highlights(req: ScoreHighlightsRequest) -> ScoreHighlightsResponse:
    """Score a batch of 5-dim highlight feature vectors. Returns [0,1] per row.

    Falls back to 0.5 per row when no trained model is available (cold start).
    """
    classifier = _get_classifier()
    scores = classifier.score(req.features)
    return ScoreHighlightsResponse(scores=scores)


@app.post("/train-classifier", response_model=TrainClassifierResponse)
async def train_classifier(req: TrainClassifierRequest) -> TrainClassifierResponse:
    """Train the XGBoost highlight classifier on promotion feedback.

    No-op if fewer than 50 training events are provided (cold-start gate).
    """
    from .classifier import MIN_TRAINING_EVENTS

    if len(req.features) < MIN_TRAINING_EVENTS:
        return TrainClassifierResponse(trained=0, noop=True)

    classifier = _get_classifier()
    classifier.train(req.features, req.labels)
    return TrainClassifierResponse(trained=len(req.features), noop=False)
