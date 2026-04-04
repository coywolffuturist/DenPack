/**
 * LEANN — Local Embedding + Approximate Nearest Neighbor layer for DenPack agents.
 *
 * Provides semantic recall via vector similarity search. Designed to slot under
 * SimpleMem as the embedding backend once a local model is available on Den.
 *
 * Replace with actual HNSW/ScaNN implementation when embedding model is available on Den.
 *
 * See: specs/system-design.md §V2 Enhancements — Semantic Memory Retrieval
 */

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface LEANNIndex {
  /**
   * Index a vector under `key` for future similarity search.
   */
  add(key: string, vector: number[]): void;

  /**
   * Return the `topK` keys whose stored vectors are closest to `vector`.
   * Falls back to recency-ordered recall (via SimpleMem) until implemented.
   */
  search(vector: number[], topK: number): string[];

  /**
   * Number of vectors currently indexed.
   */
  size(): number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Stub implementation — logs a warning and falls back to recency.
 *
 * TODO: Replace with HNSW (e.g. hnswlib-node) or ScaNN bindings once an
 * embedding model (e.g. nomic-embed-text, bge-small) is running on Den via
 * LM Studio or Ollama. Wire add() to embed on set(), search() to embed the
 * query string and run ANN lookup.
 */
export class LocalLEANNIndex implements LEANNIndex {
  add(key: string, _vector: number[]): void {
    // TODO: index the vector under key in the HNSW/ScaNN graph.
    console.warn(`LEANN not yet implemented — falling back to recency (add called for key: ${key})`);
  }

  search(_vector: number[], topK: number): string[] {
    // TODO: embed the query and run ANN lookup against the indexed vectors.
    console.warn(`LEANN not yet implemented — falling back to recency (search called for topK: ${topK})`);
    return [];
  }

  size(): number {
    // TODO: return actual index size once HNSW/ScaNN is wired.
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const leannIndex = new LocalLEANNIndex();
