import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SectionRef {
  file: string;
  start: number;
  end: number;
  label: string;
}

export type MemoryIndex = Record<string, Record<string, Omit<SectionRef, 'label'>>>;

// ---------------------------------------------------------------------------
// Parse memory-index.md
// ---------------------------------------------------------------------------

/**
 * Parses a memory-index.md file into a structured lookup.
 *
 * Expected format:
 *   ## group-name
 *   - section-label: relative/path/to/file.md#L10-45
 */
export function loadMemoryIndex(indexPath: string): MemoryIndex {
  const raw = readFileSync(indexPath, 'utf8');
  const index: MemoryIndex = {};
  let currentGroup = '';

  for (const line of raw.split('\n')) {
    const groupMatch = line.match(/^## (.+)/);
    if (groupMatch) {
      currentGroup = groupMatch[1].trim();
      index[currentGroup] = {};
      continue;
    }

    const sectionMatch = line.match(/^- ([^:]+):\s*(.+?)#L(\d+)-(\d+)\s*$/);
    if (sectionMatch && currentGroup) {
      const [, label, file, start, end] = sectionMatch;
      index[currentGroup][label.trim()] = {
        file: file.trim(),
        start: parseInt(start, 10),
        end: parseInt(end, 10),
      };
    }
  }

  return index;
}

// ---------------------------------------------------------------------------
// Section selection
// ---------------------------------------------------------------------------

/**
 * Selects relevant memory sections based on task domain + text.
 * Extend this function as memory grows.
 */
export function selectSections(
  domain: string,
  taskText: string,
  index: MemoryIndex,
  _memoryRoot: string
): SectionRef[] {
  const lower = taskText.toLowerCase();
  const selected: SectionRef[] = [];

  const add = (group: string, label: string) => {
    const ref = index[group]?.[label];
    if (ref) selected.push({ ...ref, label: `${group}/${label}` });
  };

  // --- Domain baseline ---
  switch (domain) {
    case 'prowl':
      add('prowl-strategies', 'active-strategies');
      add('prowl-strategies', 'risk-rules');
      add('projects', 'prowl');
      break;
    case 'lucid':
      add('projects', 'lucid');
      add('goals', 'q2-priorities');
      break;
    case 'research':
      add('goals', 'q2-priorities');
      add('goals', 'revenue-targets');
      break;
    case 'code':
      add('projects', 'denpack');
      break;
    case 'report':
      add('goals', 'revenue-targets');
      add('projects', 'prowl');
      break;
  }

  // --- Keyword augmentation ---
  if (lower.includes('backtest') || lower.includes('historical'))
    add('prowl-strategies', 'backtest-history');
  if (lower.includes('polymarket') || lower.includes('venue') || lower.includes('kalshi'))
    add('prowl-strategies', 'polymarket-venues');
  if (lower.includes('revenue') || lower.includes('milestone') || lower.includes('target'))
    add('goals', 'revenue-targets');
  if (lower.includes('lucid') || lower.includes('feature') || lower.includes('build'))
    add('projects', 'lucid');
  if (lower.includes('denpack') || lower.includes('pack') || lower.includes('agent'))
    add('projects', 'denpack');
  if (lower.includes('brendan') || lower.includes('preference') || lower.includes('user'))
    add('people', 'brendan');

  // Deduplicate by label
  const seen = new Set<string>();
  return selected.filter(s => {
    if (seen.has(s.label)) return false;
    seen.add(s.label);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Line extraction
// ---------------------------------------------------------------------------

function extractLines(memoryRoot: string, file: string, start: number, end: number): string {
  const fullPath = path.join(memoryRoot, file);
  try {
    const lines = readFileSync(fullPath, 'utf8').split('\n');
    return lines.slice(start - 1, end).join('\n');
  } catch {
    return `<!-- ERROR: could not read ${file}#L${start}-${end} -->`;
  }
}

// ---------------------------------------------------------------------------
// Build agent context file
// ---------------------------------------------------------------------------

/**
 * Selects relevant memory sections and writes a single composite context.md
 * to the agent's working directory. Returns the path written.
 *
 * Falls back to copying full files if index is missing (v1 behavior).
 */
export function buildAgentContext(opts: {
  agent: string;
  domain: string;
  taskText: string;
  agentDir: string;
  memoryRoot: string;
  indexPath: string;
  fallbackFiles?: string[];
}): { contextPath: string; sectionCount: number; tokenEstimate: number } {
  const { domain, taskText, agentDir, memoryRoot, indexPath, fallbackFiles = [] } = opts;

  mkdirSync(agentDir, { recursive: true });
  const contextPath = path.join(agentDir, 'context.md');

  let index: MemoryIndex;
  try {
    index = loadMemoryIndex(indexPath);
  } catch {
    // Fallback: copy full files (v1 behavior)
    const parts = fallbackFiles.map(f => {
      try { return readFileSync(path.join(memoryRoot, f), 'utf8'); }
      catch { return `<!-- missing: ${f} -->`; }
    });
    writeFileSync(contextPath, parts.join('\n\n---\n\n'));
    return { contextPath, sectionCount: fallbackFiles.length, tokenEstimate: -1 };
  }

  const sections = selectSections(domain, taskText, index, memoryRoot);

  const parts = sections.map(ref => {
    const content = extractLines(memoryRoot, ref.file, ref.start, ref.end);
    return `<!-- ${ref.label}: ${ref.file}#L${ref.start}-${ref.end} -->\n${content}`;
  });

  const output = parts.join('\n\n---\n\n');
  writeFileSync(contextPath, output);

  // Rough token estimate: ~4 chars per token
  const tokenEstimate = Math.ceil(output.length / 4);

  return { contextPath, sectionCount: sections.length, tokenEstimate };
}
