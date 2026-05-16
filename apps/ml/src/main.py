"""FastAPI ML service — text embedding endpoint."""

from __future__ import annotations

import os

from fastapi import FastAPI
from pydantic import BaseModel

from .embedder import embed as _embed

app = FastAPI(title="Zettelkasten ML Service", version="0.1.0")


class EmbedRequest(BaseModel):
    texts: list[str]


class EmbedResponse(BaseModel):
    vectors: list[list[float]]
    modelVersion: str


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/embed", response_model=EmbedResponse)
async def embed(req: EmbedRequest) -> EmbedResponse:
    """Embed a list of texts and return 768-dim vectors."""
    vectors, model_version = _embed(req.texts)
    return EmbedResponse(vectors=vectors, modelVersion=model_version)
