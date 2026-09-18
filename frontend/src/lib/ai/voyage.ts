// Plain-fetch Voyage AI embeddings client. Used to chunk + embed scraped
// source text into supabase/schema.sql's source_chunks table (pgvector) —
// see DESIGN.md's "Why Voyage AI?" reasoning: Anthropic doesn't run its own
// embeddings endpoint and recommends Voyage as the pairing.
// https://docs.voyageai.com/reference/embeddings-api

import { VOYAGE_API_KEY, VOYAGE_EMBEDDING_MODEL } from "../config";

const CHUNK_SIZE_WORDS = 350; // ~500 tokens, CONTENT-PIPELINE-SPEC.md §1
const CHUNK_OVERLAP_WORDS = 35; // ~50 tokens

/** Splits text into overlapping word-based chunks. A word-count
 * approximation of the spec'd ~500-token/~50-token-overlap chunking —
 * close enough for chunk boundaries, which don't need to be exact. */
export function chunkText(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + CHUNK_SIZE_WORDS, words.length);
    chunks.push(words.slice(start, end).join(" "));
    if (end === words.length) break;
    start = end - CHUNK_OVERLAP_WORDS;
  }
  return chunks;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!VOYAGE_API_KEY) {
    throw new Error("VOYAGE_API_KEY is not set — see .env.example.");
  }

  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ input: texts, model: VOYAGE_EMBEDDING_MODEL }),
  });

  if (!res.ok) {
    throw new Error(`Voyage embeddings request failed: ${res.status} ${await res.text()}`);
  }

  const body = await res.json();
  const data: Array<{ embedding: number[] }> = body?.data ?? [];
  return data.map((d) => d.embedding);
}
