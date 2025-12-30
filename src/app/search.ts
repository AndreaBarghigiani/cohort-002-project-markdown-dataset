import BM25 from "okapibm25";
import { Doc } from "@/types";
import path from "path";
import fs from "fs/promises";
import { embed, embedMany, cosineSimilarity } from "ai";
import { google } from "@ai-sdk/google";

type EmbedDoc = {
  id: string;
  embedding: number[];
};

export function searchWithBM25(keywords: string[], docs: Doc[]) {
  const corpus = docs.map((doc) => `${doc.subject} ${doc.content}`);

  const scores: number[] = (BM25 as any)(corpus, keywords);

  return scores
    .map((score, idx) => ({ score, doc: docs[idx] }))
    .sort((a, b) => b.score - a.score);
}

const CACHE_DIR = path.join(process.cwd(), "data", "embeddings");

const CACHE_KEY = "google-text-embedding-004";

const EMBEDDING_MODEL = google.textEmbeddingModel("text-embedding-004");

const getEmbeddingFilePath = (id: string) =>
  path.join(CACHE_DIR, `${CACHE_KEY}-${id}.json`);

export async function loadOrGenerateEmbeddings(
  docs: Doc[]
): Promise<EmbedDoc[]> {
  await fs.mkdir(CACHE_DIR, { recursive: true });

  const results: EmbedDoc[] = [];
  const unCachedDocs: Doc[] = [];

  for (const doc of docs) {
    try {
      const cached = await fs.readFile(getEmbeddingFilePath(doc.id), "utf-8");
      const data = JSON.parse(cached);
      results.push({ id: doc.id, embedding: data.embedding });
    } catch {
      // Cache miss - need to generate
      unCachedDocs.push(doc);
    }
  }

  // Generate embeddings for uncached emails in batches of 99
  if (unCachedDocs.length > 0) {
    console.log(`Generating embeddings for ${unCachedDocs.length} docs`);

    const BATCH_SIZE = 99;
    for (let i = 0; i < unCachedDocs.length; i += BATCH_SIZE) {
      const batch = unCachedDocs.slice(i, i + BATCH_SIZE);
      console.log(
        `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(
          unCachedDocs.length / BATCH_SIZE
        )}`
      );

      const { embeddings } = await embedMany({
        model: EMBEDDING_MODEL,
        values: batch.map((doc) => `${doc.subject} ${doc.content}`),
      });

      // Write batch to cache
      for (let i = 0; i < batch.length; i++) {
        const doc = batch[i];
        const embedding = embeddings[i];
        const embedDoc = { id: doc.id, embedding };

        await fs.writeFile(
          getEmbeddingFilePath(doc.id),
          JSON.stringify(embedDoc)
        );

        results.push(embedDoc);
      }
    }
  }

  return results;
}

export async function searchWithEmbeddings(query: string, docs: Doc[]) {
  const embedDocs = await loadOrGenerateEmbeddings(docs);
  const { embedding: embedQuery } = await embed({
    model: EMBEDDING_MODEL,
    value: query,
  });

  console.log("original query in embeddings", query);

  const results = embedDocs.map(({ id, embedding }) => {
    const doc = docs.find((e) => e.id === id)!;
    const score = cosineSimilarity(embedQuery, embedding);

    return { score, doc };
  });

  console.log(
    "Results:",
    results.length,
    "first",
    { subject: results[0].doc.subject, score: results[0].score },
    "second",
    { subject: results[1].doc.subject, score: results[1].score }
  );

  return results.sort((a, b) => b.score - a.score);
}
