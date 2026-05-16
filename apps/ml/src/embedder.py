"""Embedder: wraps sentence-transformers for text embedding."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass

MODEL_NAME = "nomic-ai/nomic-embed-text-v1.5"

# Lazy-loaded at module level so the first call downloads/loads the model.
_model: "SentenceTransformerModel | None" = None


class SentenceTransformerModel:
    """Thin wrapper so we can swap out the real model in tests."""

    def __init__(self, model_name: str) -> None:
        from sentence_transformers import SentenceTransformer  # type: ignore[import]

        self._inner = SentenceTransformer(model_name, trust_remote_code=True)

    def encode(self, texts: list[str]) -> list[list[float]]:
        result = self._inner.encode(texts, normalize_embeddings=True)
        return result.tolist()


def _get_model() -> SentenceTransformerModel:
    global _model
    if _model is None:
        _model = SentenceTransformerModel(MODEL_NAME)
    return _model


def embed(texts: list[str], *, model: SentenceTransformerModel | None = None) -> tuple[list[list[float]], str]:
    """Embed a list of texts.

    Returns:
        (vectors, model_version) where vectors[i] is the 768-dim embedding for texts[i].
    """
    if not texts:
        return [], MODEL_NAME

    m = model if model is not None else _get_model()
    vectors = m.encode(texts)
    return vectors, MODEL_NAME
