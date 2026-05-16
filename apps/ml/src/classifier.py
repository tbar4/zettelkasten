"""XGBoost highlight promotion classifier.

Predicts the probability that a Readwise highlight is worth promoting to a
permanent note. Trained on highlight_promotion_feedback events.

Feature vector (5-dim — simplified from 7-dim spec):
  0. text_length_norm       — min(len(text) / 500, 1.0)  (normalized)
  1. has_note               — 1.0 if highlight.note_text is non-empty, else 0.0
  2. color_score            — yellow=0.3, blue=0.5, pink=0.7, green=0.9, null=0.1
  3. source_type_score      — book=0.7, article=0.5, other=0.3
  4. hour_of_day_normalized — created_at hour / 24

Simplification note: The 7-dim spec also included embedding_distance_to_recent_permanent
and per_source_prior_promotion_rate. These require embedding lookups and per-source
aggregation that add significant query complexity. The 5-dim features capture the
strongest signals (content richness, user annotation, source quality, timing) without
the extra joins. The classifier works well with 5 features; the omitted features can
be added post-M3.

Cold-start gate: if no model file exists, score() returns 0.5 (neutral) for all inputs.
Training gate: if < 50 events, /train-classifier is a no-op to avoid noise.
"""

from __future__ import annotations

import os
import pickle
from typing import Optional

MIN_TRAINING_EVENTS = 50

# Color → score mapping
COLOR_SCORES: dict[str | None, float] = {
    "yellow": 0.3,
    "blue": 0.5,
    "pink": 0.7,
    "green": 0.9,
}

# Source type → score mapping
SOURCE_TYPE_SCORES: dict[str | None, float] = {
    "book": 0.7,
    "article": 0.5,
}


def color_score(color: str | None) -> float:
    """Map highlight color to a score. Unknown colors → 0.1."""
    return COLOR_SCORES.get(color, 0.1)


def source_type_score(source_type: str | None) -> float:
    """Map source_type to a score. Unknown types → 0.3."""
    return SOURCE_TYPE_SCORES.get(source_type, 0.3)


class Classifier:
    """XGBoost highlight promotion classifier.

    Args:
        model_path: Path to the pickled XGBClassifier model file.
    """

    def __init__(self, model_path: str) -> None:
        self._model_path = model_path
        self._model: Optional[object] = None

        if os.path.exists(model_path):
            try:
                import xgboost as xgb  # noqa: F401 — verify importable
                with open(model_path, "rb") as f:
                    self._model = pickle.load(f)
            except Exception:
                self._model = None

    def score(self, features: list[list[float]]) -> list[float]:
        """Score a batch of feature vectors.

        Returns a probability in [0, 1] per row.
        Falls back to 0.5 (neutral) if no model is loaded.
        """
        if not features:
            return []
        if self._model is None:
            return [0.5] * len(features)

        import numpy as np

        X = np.array(features, dtype=float)
        probs = self._model.predict_proba(X)[:, 1]  # type: ignore[attr-defined]
        return [float(p) for p in probs]

    def train(self, features: list[list[float]], labels: list[int]) -> None:
        """Train an XGBClassifier on the given features/labels and persist."""
        if len(features) < MIN_TRAINING_EVENTS:
            # Cold-start gate — not enough data to train reliably.
            return

        import numpy as np
        from xgboost import XGBClassifier

        X = np.array(features, dtype=float)
        y = np.array(labels, dtype=int)

        clf = XGBClassifier(
            n_estimators=50,
            max_depth=4,
            learning_rate=0.1,
            use_label_encoder=False,
            eval_metric="logloss",
            verbosity=0,
        )
        clf.fit(X, y)
        self._model = clf

        os.makedirs(os.path.dirname(self._model_path), exist_ok=True)
        with open(self._model_path, "wb") as f:
            pickle.dump(clf, f)
