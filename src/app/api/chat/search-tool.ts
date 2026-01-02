import { loadVaultEntries } from "@/lib/vault-loader";
import {
  searchWithBM25KeywordGeneration,
  searchWithEmbeddings,
  reciprocalRankFusion,
} from "@/app/search";
import { tool } from "ai";
import { z } from "zod";

export const searchTool = tool({
  description:
    "Search documents using both keywords and semantic search. Returns most relevant docs ranked by reciprocel rank fusion.",
  inputSchema: z.object({
    searchQuery: z
      .string()
      .describe("Natural language query for semantic search"),
  }),
  execute: async ({ searchQuery }) => {
    const vaultPath = process.env.WORKING_KNOWLEDGE_VAULT!;
    const allDocs = await loadVaultEntries(vaultPath);

    console.log("Search query", searchQuery);

    const bm25Results =
      (await searchWithBM25KeywordGeneration(searchQuery, allDocs)) ?? [];
    const semanticResults =
      (await searchWithEmbeddings(searchQuery, allDocs)) ?? [];

    const rrfResults = reciprocalRankFusion([
      bm25Results.slice(0, 30),
      semanticResults.slice(0, 30),
    ]);

    const topDocs = rrfResults
      .slice(0, 10)
      .filter((r) => r.score > 0)
      .map((item) => ({
        ...item.doc,
        score: item.score,
      }));

    return { docs: topDocs };
  },
});
