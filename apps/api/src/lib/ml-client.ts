/**
 * ML client interface + HTTP implementation for the FastAPI embedding service.
 * Shared between the search route and other API consumers.
 */

export interface MLClient {
  embed(texts: string[]): Promise<{ vectors: number[][]; modelVersion: string }>;
  rerank(features: number[][]): Promise<{ scores: number[] }>;
  trainReranker(
    features: number[][],
    labels: number[]
  ): Promise<{ trained: number; loss: number }>;
  scoreHighlights(features: number[][]): Promise<{ scores: number[] }>;
  trainClassifier(
    features: number[][],
    labels: number[]
  ): Promise<{ trained: number; noop: boolean }>;
}

export function httpMlClient(baseUrl: string): MLClient {
  return {
    async embed(texts: string[]) {
      const res = await fetch(`${baseUrl}/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts })
      });
      if (!res.ok) {
        throw new Error(`ML service error: ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as { vectors: number[][]; modelVersion: string };
    },

    async rerank(features: number[][]) {
      const res = await fetch(`${baseUrl}/rerank`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features })
      });
      if (!res.ok) {
        throw new Error(`ML service error: ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as { scores: number[] };
    },

    async trainReranker(features: number[][], labels: number[]) {
      const res = await fetch(`${baseUrl}/train-reranker`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features, labels })
      });
      if (!res.ok) {
        throw new Error(`ML service error: ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as { trained: number; loss: number };
    },

    async scoreHighlights(features: number[][]) {
      const res = await fetch(`${baseUrl}/score-highlights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features })
      });
      if (!res.ok) {
        throw new Error(`ML service error: ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as { scores: number[] };
    },

    async trainClassifier(features: number[][], labels: number[]) {
      const res = await fetch(`${baseUrl}/train-classifier`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features, labels })
      });
      if (!res.ok) {
        throw new Error(`ML service error: ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as { trained: number; noop: boolean };
    }
  };
}
