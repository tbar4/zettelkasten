"""Personal re-ranker: a 2-layer MLP trained on user accept/reject feedback.

Input features (dim=5):
  0. cosine_sim            — cosine similarity from pgvector
  1. shared_tags_count     — number of shared tags between source and candidate
  2. same_type_flag        — 1 if note.type matches, else 0
  3. link_density_ratio    — 1 if any link exists between notes, else 0
  4. temporal_proximity    — 1 / (1 + |days_between_updates|), capped at 1

Architecture: Linear(5,32) → ReLU → Linear(32,16) → ReLU → Linear(16,1) → Sigmoid
"""

from __future__ import annotations

import os
from typing import Optional

import torch
import torch.nn as nn

INPUT_DIM = 5
HIDDEN1 = 32
HIDDEN2 = 16
LEARNING_RATE = 1e-3


class _MLP(nn.Module):
    """Simple 2-hidden-layer MLP with sigmoid output for ranking."""

    def __init__(self) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(INPUT_DIM, HIDDEN1),
            nn.ReLU(),
            nn.Linear(HIDDEN1, HIDDEN2),
            nn.ReLU(),
            nn.Linear(HIDDEN2, 1),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)


class Reranker:
    """Loads (or initialises) the MLP and provides inference + training."""

    def __init__(self, model_path: str) -> None:
        self._model_path = model_path
        self._model = _MLP()
        self._optimizer = torch.optim.Adam(self._model.parameters(), lr=LEARNING_RATE)
        self._criterion = nn.BCELoss()

        if os.path.exists(model_path):
            state = torch.load(model_path, map_location="cpu", weights_only=True)
            self._model.load_state_dict(state)

    def score(self, features: list[list[float]]) -> list[float]:
        """Score a batch of feature vectors. Returns a score in [0, 1] per row."""
        if not features:
            return []
        self._model.eval()
        with torch.no_grad():
            x = torch.tensor(features, dtype=torch.float32)
            scores = self._model(x)
        return scores.tolist()

    def train_step(
        self,
        features: list[list[float]],
        labels: list[int],
    ) -> float:
        """One mini-batch SGD update. Returns the loss value.

        Args:
            features: List of 5-dim feature vectors.
            labels:   Parallel list of 0/1 labels (1=accepted, 0=rejected/dismissed).

        Returns:
            Scalar loss (float) for this batch.
        """
        if not features:
            return 0.0

        self._model.train()
        self._optimizer.zero_grad()

        x = torch.tensor(features, dtype=torch.float32)
        y = torch.tensor(labels, dtype=torch.float32)

        preds = self._model(x)
        loss = self._criterion(preds, y)
        loss.backward()
        self._optimizer.step()

        return float(loss.item())

    def save(self) -> None:
        """Persist model weights to disk."""
        os.makedirs(os.path.dirname(self._model_path), exist_ok=True)
        torch.save(self._model.state_dict(), self._model_path)
