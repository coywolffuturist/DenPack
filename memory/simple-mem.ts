/**
 * SimpleMem — lightweight in-process key/value memory layer for DenPack agents.
 *
 * Designed for DenPack v2: gives agents persistent memory without Postgres round-trips.
 * Recency-sorted search is the fallback until LEANN embeddings are wired in.
 *
 * See: specs/system-design.md §V2 Enhancements — Semantic Memory Retrieval
 */

import fs from "fs/promises";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemEntry {
  key: string;
  value: unknown;
  metadata?: Record<string, unknown>;
  /** Reserved for LEANN — null until embedding model is available on Den. */
  embedding: null;
  /** Relevance score — 0 until LEANN scoring is wired. */
  score: number;
  createdAt: string;
  accessedAt: string;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface SimpleMem {
  /**
   * Store a value under `key`. Overwrites any existing entry for that key.
   */
  set(key: string, value: unknown, metadata?: Record<string, unknown>): void;

  /**
   * Retrieve the value stored at `key`, or undefined if not found.
   * Updates `accessedAt` on hit.
   */
  get(key: string): unknown | undefined;

  /**
   * Return the top `topK` entries most relevant to `query`.
   * Falls back to recency sort (newest accessedAt first) until LEANN is wired.
   */
  search(query: string, topK: number): MemEntry[];

  /**
   * Persist the current store to a JSON file at `persistPath`.
   */
  flush(): Promise<void>;

  /**
   * Load previously persisted entries from `persistPath`.
   * Merges with (overwrites) any in-memory entries with matching keys.
   */
  load(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class InMemorySimpleMem implements SimpleMem {
  private store: Map<string, MemEntry> = new Map();

  /**
   * Path for flush/load persistence. Override via constructor or set directly.
   * Defaults to `./simplemem-store.json` relative to cwd.
   */
  public persistPath: string;

  constructor(persistPath?: string) {
    this.persistPath = persistPath ?? path.resolve(process.cwd(), "simplemem-store.json");
  }

  set(key: string, value: unknown, metadata?: Record<string, unknown>): void {
    const now = new Date().toISOString();
    const existing = this.store.get(key);
    this.store.set(key, {
      key,
      value,
      metadata: metadata ?? existing?.metadata,
      embedding: null,
      score: 0,
      createdAt: existing?.createdAt ?? now,
      accessedAt: now,
    });
  }

  get(key: string): unknown | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    // Update recency timestamp on access
    entry.accessedAt = new Date().toISOString();
    return entry.value;
  }

  search(query: string, topK: number): MemEntry[] {
    // TODO: wire LEANN vector search here once embedding model is available on Den.
    // For now: recency fallback — sort by accessedAt descending.
    void query; // query will drive LEANN once wired
    const entries = Array.from(this.store.values());
    entries.sort((a, b) => (a.accessedAt < b.accessedAt ? 1 : -1));
    return entries.slice(0, topK);
  }

  async flush(): Promise<void> {
    const entries = Array.from(this.store.values());
    await fs.mkdir(path.dirname(this.persistPath), { recursive: true });
    await fs.writeFile(this.persistPath, JSON.stringify(entries, null, 2), "utf-8");
  }

  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await fs.readFile(this.persistPath, "utf-8");
    } catch {
      // File doesn't exist yet — start with empty store
      return;
    }
    const entries: MemEntry[] = JSON.parse(raw);
    for (const entry of entries) {
      this.store.set(entry.key, entry);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const simpleMem = new InMemorySimpleMem();
