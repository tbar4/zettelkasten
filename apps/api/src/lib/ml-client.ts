/**
 * ML client interface + HTTP implementation for the FastAPI embedding service.
 * Shared between the search route and other API consumers.
 */

export interface MLClient {
  embed(texts: string[]): Promise<{ vectors: number[][]; modelVersion: string }>;
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
    }
  };
}
