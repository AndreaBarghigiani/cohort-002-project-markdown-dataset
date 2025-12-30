import BM25 from "okapibm25";
import { loadVaultEntries } from "@/lib/vault-loader";

interface VaultDoc {
  id: string;
  from: string;
  subject: string;
  content: string;
  timestamp: string;
}

export function searchWithBM25(keywords: string[], docs: VaultDoc[]) {
  const corpus = docs.map((doc) => `${doc.subject} ${doc.content}`);

  const scores: number[] = (BM25 as any)(corpus, keywords);

  return scores
    .map((score, idx) => ({ score, doc: docs[idx] }))
    .sort((a, b) => b.score - a.score);
}

export async function loadVaultDocs(): Promise<VaultDoc[]> {
  const vaultPath = process.env.WORKING_KNOWLEDGE_VAULT!;

  const entries = await loadVaultEntries(vaultPath);

  return entries.map((entry) => ({
    id: entry.id,
    from: entry.relativePath,
    subject: entry.title,
    content: entry.content,
    timestamp: entry.date,
  }));
}
