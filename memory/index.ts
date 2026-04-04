/**
 * memory/index.ts — unified entry point for DenPack agent memory.
 *
 * Exports SimpleMem and LEANN singletons, plus a combineSearch() helper
 * that routes through SimpleMem today and will wire LEANN once available.
 */

export { simpleMem, InMemorySimpleMem } from './simple-mem.js';
export type { SimpleMem, MemEntry } from './simple-mem.js';

export { leannIndex, LocalLEANNIndex } from './leann.js';
export type { LEANNIndex } from './leann.js';

import { simpleMem } from './simple-mem.js';
import type { MemEntry } from './simple-mem.js';

/**
 * Search agent memory. Routes through SimpleMem (recency fallback) today.
 * TODO: wire LEANN semantic search once embedding model is available on Den.
 */
export function combineSearch(query: string, topK: number): MemEntry[] {
  return simpleMem.search(query, topK);
}
