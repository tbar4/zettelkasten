"""FastAPI ML service — text embedding + re-ranking endpoints."""

from __future__ import annotations

import os

from fastapi import FastAPI
from pydantic import BaseModel

from .embedder import embed as _embed
from .reranker import Reranker

app = FastAPI(title="Zettelkasten ML Service", version="0.1.0")

# ---------------------------------------------------------------------------
# Lazy singleton for the re-ranker
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
