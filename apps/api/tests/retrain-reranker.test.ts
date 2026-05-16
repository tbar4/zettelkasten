import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as rawSql } from "drizzle-orm";
import * as schema from "@zk/db-schema";
import { app } from "../src/server";
import { setMlClientForMl } from "../src/routes/ml";
import type { MLClient } from "../src/lib/ml-client";

const url =
  process.env.DATABASE_URL_TEST ?? "postgres://zk:zk@localhost:5433/zettel_test";
const pgClient = postgres(url, { max: 1 });
const db = drizzle(pgClient, { schema });

afterAll(async () => {
  setMlClientForMl(null);
  await pgClient.end();
});

function vecLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

function makeVector(scale: number): number[] {
  return Array.from({ length: 768 }, (_, i) => Math.cos(i * scale));
}

async function insertNote(title: string, type = "fleeting"): Promise<string> {
  const [row] = await db
    .insert(schema.notes)
    .values({ type: type as "fleeting", title })
    .returning({ id: schema.notes.id });
  return row!.id;
}

async function insertEmbedding(noteId: string, vec: number[]): Promise<void> {
  await db.execute(rawSql`
    INSERT INTO embedding (note_id, vector, model_version)
    VALUES (${noteId}::uuid, ${vecLiteral(vec)}::vector, 'test-model')
  `);
}

async function insertFeedback(
  fromId: string | null,
  toId: string,
  action: string
): Promise<void> {
  await db.insert(schema.suggestionFeedback).values({
    fromNoteId: fromId,
    toNoteId: toId,
    action,
    surfacedAt: new Date()
  });
}

/** A mock ML client that captures training calls */
function capturingMlClient(): MLClient & {
  capturedFeatures: number[][];
  capturedLabels: number[];
} {
  const capturedFeatures: number[][] = [];
  const capturedLabels: number[] = [];
  return {
    capturedFeatures,
    capturedLabels,
    async embed(_texts) {
      return { vectors: [], modelVersion: "test" };
    },
    async rerank(features) {
      return { scores: features.map(() => 0.5) };
    },
    async trainReranker(features, labels) {
      capturedFeatures.push(...features);
      capturedLabels.push(...labels);
      return { trained: features.length, loss: 0.1 };
    },
    async scoreHighlights(features) {
      return { scores: features.map(() => 0.5) };
    },
    async trainClassifier(_features, _labels) {
      return { trained: 0, noop: true };
    }
  };
}

function failingMlClient(): MLClient {
  return {
    async embed(_texts) { throw new Error("ML down"); },
    async rerank(_features) { throw new Error("ML down"); },
    async trainReranker(_features, _labels) { throw new Error("ML down"); },
    async scoreHighlights(_features) { throw new Error("ML down"); },
    async trainClassifier(_features, _labels) { throw new Error("ML down"); }
  };
}

describe("POST /api/ml/retrain-reranker", () => {
  it("returns trained:0 status:ok when no feedback exists", async () => {
    const mock = capturingMlClient();
    setMlClientForMl(mock);

    const res = await app.request("/api/ml/retrain-reranker", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { trained: number; status: string };
    expect(body.trained).toBe(0);
    expect(body.status).toBe("ok");
  });

  it("trains on feedback rows and returns trained count", async () => {
    const from = await insertNote("Source note");
    const to = await insertNote("Target note");
    await insertEmbedding(from, makeVector(0.1));
    await insertEmbedding(to, makeVector(0.5));
    await insertFeedback(from, to, "accepted");

    const mock = capturingMlClient();
    setMlClientForMl(mock);

    const res = await app.request("/api/ml/retrain-reranker", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { trained: number; status: string };
    expect(body.status).toBe("ok");
    expect(body.trained).toBeGreaterThanOrEqual(1);
    // Should have called trainReranker with feature vectors
    expect(mock.capturedFeatures.length).toBeGreaterThanOrEqual(1);
    expect(mock.capturedFeatures[0]).toHaveLength(5);
    expect(mock.capturedLabels[0]).toBe(1); // accepted → label 1
  });

  it("labels rejected/dismissed as 0", async () => {
    const from = await insertNote("From note");
    const to = await insertNote("To note");
    await insertFeedback(from, to, "rejected");

    const mock = capturingMlClient();
    setMlClientForMl(mock);

    await app.request("/api/ml/retrain-reranker", { method: "POST" });
    expect(mock.capturedLabels[0]).toBe(0);
  });

  it("returns ml-unavailable when ML service is down", async () => {
    const from = await insertNote("Note A");
    const to = await insertNote("Note B");
    await insertFeedback(from, to, "accepted");

    setMlClientForMl(failingMlClient());

    const res = await app.request("/api/ml/retrain-reranker", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { trained: number; status: string };
    expect(body.status).toBe("ml-unavailable");
    expect(body.trained).toBe(0);
  });
});

describe("Feature extraction", () => {
  it("returns all-zero features when fromNoteId is null", async () => {
    const { computeFeatures } = await import("../src/lib/reranker-features");
    const toId = await insertNote("To note");
    const features = await computeFeatures(null, toId);
    expect(features.cosineSim).toBe(0);
    expect(features.sharedTagsCount).toBe(0);
    expect(features.sameTypeFlag).toBe(0);
    expect(features.linkDensityRatio).toBe(0);
    expect(features.temporalProximityDays).toBe(0);
  });

  it("computes cosineSim=0 when no embeddings", async () => {
    const { computeFeatures } = await import("../src/lib/reranker-features");
    const from = await insertNote("From");
    const to = await insertNote("To");
    const features = await computeFeatures(from, to);
    expect(features.cosineSim).toBe(0);
  });

  it("computes cosineSim > 0 when embeddings exist", async () => {
    const { computeFeatures } = await import("../src/lib/reranker-features");
    const from = await insertNote("From");
    const to = await insertNote("To");
    await insertEmbedding(from, makeVector(0.1));
    await insertEmbedding(to, makeVector(0.15));
    const features = await computeFeatures(from, to);
    expect(features.cosineSim).toBeGreaterThan(0);
  });

  it("computes sameTypeFlag correctly", async () => {
    const { computeFeatures } = await import("../src/lib/reranker-features");
    const from = await insertNote("Fleeting", "fleeting");
    const to = await insertNote("Permanent", "permanent");
    const features = await computeFeatures(from, to);
    expect(features.sameTypeFlag).toBe(0);

    const from2 = await insertNote("Fleeting 2", "fleeting");
    const to2 = await insertNote("Fleeting 3", "fleeting");
    const features2 = await computeFeatures(from2, to2);
    expect(features2.sameTypeFlag).toBe(1);
  });

  it("computes linkDensityRatio = 1 when link exists", async () => {
    const { computeFeatures } = await import("../src/lib/reranker-features");
    const from = await insertNote("Linked from");
    const to = await insertNote("Linked to");
    await db.insert(schema.noteLinks).values({
      fromNoteId: from,
      toNoteId: to,
      linkType: "references",
      source: "manual"
    });
    const features = await computeFeatures(from, to);
    expect(features.linkDensityRatio).toBe(1);
  });

  it("temporalProximityDays is in (0, 1]", async () => {
    const { computeFeatures } = await import("../src/lib/reranker-features");
    const from = await insertNote("TP from");
    const to = await insertNote("TP to");
    const features = await computeFeatures(from, to);
    expect(features.temporalProximityDays).toBeGreaterThan(0);
    expect(features.temporalProximityDays).toBeLessThanOrEqual(1);
  });
});
