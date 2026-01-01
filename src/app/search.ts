import BM25 from "okapibm25";
import { Doc } from "@/types";
import path from "path";
import fs from "fs/promises";
import { embed, embedMany, cosineSimilarity, generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";

type EmbedDoc = {
  id: string;
  embedding: number[];
};

type RankingDoc = {
  doc: Doc;
  score: number;
};

async function generateKeywords(query: string): Promise<string[]> {
  const result = await generateObject({
    model: google("gemini-2.5-flash-lite"),
    system:
      "Extract relevant keywords from the user's search query. Return 3-7 keywords that would be effective for BM25 search.",
    schema: z.object({ keywords: z.array(z.string()) }),
    prompt: `Extract keywords from this search query: ${query}`,
  });

  return result.object.keywords;
}

const CACHE_DIR = path.join(process.cwd(), "data", "embeddings");
const CACHE_KEY = "google-text-embedding-004";
const EMBEDDING_MODEL = google.textEmbeddingModel("text-embedding-004");
const RRF_K = 60;

function reciprocalRankFusion(rankings: RankingDoc[][]): RankingDoc[] {
  const rrfScores = new Map<string, number>();
  const documentMap = new Map<string, RankingDoc>();

  rankings.forEach((ranking) => {
    ranking.forEach((item, rank) => {
      const currentScore = rrfScores.get(item.doc.id) || 0;

      const contribution = 1 / (RRF_K + rank);
      rrfScores.set(item.doc.id, currentScore + contribution);

      documentMap.set(item.doc.id, item);
    });
  });

  return Array.from(rrfScores.entries())
    .sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
    .map(([docId, score]) => {
      return {
        doc: documentMap.get(docId)!.doc,
        score,
      };
    });
}

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

/* SEARCH FUNCTIONS */
export async function searchWithBM25KeywordGeneration(
  query: string,
  docs: Doc[]
) {
  const keywords = await generateKeywords(query);
  console.log("generated keywords for BM25:", keywords);
  const corpus = docs.map((doc) => `${doc.subject} ${doc.content}`);

  const scores: number[] = (BM25 as any)(corpus, keywords);

  return scores
    .map((score, idx) => ({ score, doc: docs[idx] }))
    .sort((a, b) => b.score - a.score);
}
export async function searchWithBM25(keywords: string[], docs: Doc[]) {
  const corpus = docs.map((doc) => `${doc.subject} ${doc.content}`);

  const scores: number[] = (BM25 as any)(corpus, keywords);

  return scores
    .map((score, idx) => ({ score, doc: docs[idx] }))
    .sort((a, b) => b.score - a.score);
}

export async function searchWithEmbeddings(query: string, docs: Doc[]) {
  const embedDocs = await loadOrGenerateEmbeddings(docs);
  const { embedding: embedQuery } = await embed({
    model: EMBEDDING_MODEL,
    value: query,
  });

  const results = embedDocs.map(({ id, embedding }) => {
    const doc = docs.find((e) => e.id === id)!;
    const score = cosineSimilarity(embedQuery, embedding);

    return { score, doc };
  });

  return results.sort((a, b) => b.score - a.score);
}

export async function searchWithRRF(
  query: string,
  docs: Doc[]
): Promise<RankingDoc[]> {
  const bm25SearchResults = await searchWithBM25KeywordGeneration(query, docs);

  const embeddingsSearchResults = await searchWithEmbeddings(query, docs);

  const rrfSearchResults = reciprocalRankFusion([
    bm25SearchResults,
    embeddingsSearchResults,
  ]);

  return rrfSearchResults;
}
