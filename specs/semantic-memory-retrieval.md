# Semantic Memory Retrieval

**Status:** V2 spec — awaiting v1 validation  
**Replaces:** Blunt file-push in `coordinator/memory-sync.ts`  
**Principle:** Pull only the memory sections relevant to this specific task. No external dependencies.

---

## Problem

V1 memory sync is blunt. At task dispatch, Arbor pushes predefined full `.md` files to each agent's working directory. Lumen always gets `prowl-strategies.md` (all 160 lines) and `PROJECTS.md` (all 90 lines) regardless of what the task actually needs. This produces:

- **Token waste** — agents load context they never use
- **Noise** — irrelevant sections dilute reasoning quality
- **Fixed cost** — makes Council Mode expensive (5 agents × full files = large context per round)

---

## Solution: Two-component retrieval

### Component 1: Memory Index

A human-maintained manifest at `memory/memory-index.md` (on VPS, synced to Den). Maps topic labels to file + line ranges.

```markdown
# Memory Index

## prowl-strategies
- active-strategies: entities/prowl-strategies.md#L1-45
- risk-rules: entities/prowl-strategies.md#L46-80
- backtest-history: entities/prowl-strategies.md#L81-140
- polymarket-venues: entities/prowl-strategies.md#L141-160

## projects
- lucid: PROJECTS.md#L1-30
- denpack: PROJECTS.md#L31-60
- prowl: PROJECTS.md#L61-90

## goals
- revenue-targets: reference/GOALS.md#L1-20
- q2-priorities: reference/GOALS.md#L21-45

## people
- brendan: entities/Brendan-Joyce.md#L1-40
```

Index is updated manually when files change significantly. Low maintenance — only needs updating when section boundaries shift.

### Component 2: Arbor Retrieval Logic

New file: `coordinator/memory-retrieval.ts`

Arbor reads the task domain + text, selects relevant section labels, slices the actual lines from source files, and writes a single composite context file to the agent's working directory.

```typescript
// coordinator/memory-retrieval.ts

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';

const VPS_MEMORY = process.env.VPS_MEMORY_PATH ?? '/home/ubuntu/coywolf/memory';

type SectionRef = { file: string; start: number; end: number };
type MemoryIndex = Record<string, Record<string, SectionRef>>;

// Parse memory-index.md into structured lookup
export function loadMemoryIndex(): MemoryIndex {
  const raw = readFileSync(path.join(VPS_MEMORY, 'memory-index.md'), 'utf8');
  const index: MemoryIndex = {};
  let currentGroup = '';

  for (const line of raw.split('\n')) {
    const groupMatch = line.match(/^## (.+)/);
    if (groupMatch) { currentGroup = groupMatch[1]; index[currentGroup] = {}; continue; }

    const sectionMatch = line.match(/^- ([^:]+): (.+)#L(\d+)-(\d+)/);
    if (sectionMatch && currentGroup) {
      const [, label, file, start, end] = sectionMatch;
      index[currentGroup][label.trim()] = { file, start: parseInt(start), end: parseInt(end) };
    }
  }
  return index;
}

// Select relevant sections based on domain + task text
export function selectSections(
  domain: string,
  taskText: string,
  index: MemoryIndex
): SectionRef[] {
  const lower = taskText.toLowerCase();
  const selected: SectionRef[] = [];
  const add = (group: string, label: string) => {
    const ref = index[group]?.[label];
    if (ref) selected.push(ref);
  };

  // Domain-based baseline
  if (domain === 'prowl') {
    add('prowl-strategies', 'active-strategies');
    add('prowl-strategies', 'risk-rules');
    add('projects', 'prowl');
  }
  if (domain === 'lucid') {
    add('projects', 'lucid');
  }
  if (domain === 'research') {
    add('projects', 'denpack');
    add('goals', 'q2-priorities');
  }

  // Keyword augmentation
  if (lower.includes('backtest') || lower.includes('historical')) add('prowl-strategies', 'backtest-history');
  if (lower.includes('polymarket') || lower.includes('venue')) add('prowl-strategies', 'polymarket-venues');
  if (lower.includes('revenue') || lower.includes('milestone')) add('goals', 'revenue-targets');
  if (lower.includes('brendan') || lower.includes('user preference')) add('people', 'brendan');

  return selected;
}

// Slice lines from source file
function extractLines(file: string, start: number, end: number): string {
  const full = readFileSync(path.join(VPS_MEMORY, file), 'utf8').split('\n');
  return full.slice(start - 1, end).join('\n');
}

// Build composite context file for agent
export function buildAgentContext(
  agent: string,
  domain: string,
  taskText: string,
  agentDir: string
): string {
  const index = loadMemoryIndex();
  const sections = selectSections(domain, taskText, index);

  const parts = sections.map(ref =>
    `<!-- ${ref.file}#L${ref.start}-${ref.end} -->\n${extractLines(ref.file, ref.start, ref.end)}`
  );

  const contextPath = path.join(agentDir, 'context.md');
  writeFileSync(contextPath, parts.join('\n\n---\n\n'));
  return contextPath;
}
```

Replaces the current `syncMemoryForAgent` call in `coordinator/index.ts` with `buildAgentContext`.

---

## Self-Improving Selection (Phase 2)

After enough scored tasks accumulate in `pack_scores`, the keyword→section mapping sharpens automatically.

A weekly job reads `pack_scores` and identifies which section selections correlated with high composite scores for each task type. It updates a weights table in Neon:

```sql
CREATE TABLE pack_memory_weights (
  domain        TEXT NOT NULL,
  keyword       TEXT NOT NULL,
  section_group TEXT NOT NULL,
  section_label TEXT NOT NULL,
  weight        FLOAT DEFAULT 1.0,
  updated_at    TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (domain, keyword, section_group, section_label)
);
```

`selectSections` queries this table and uses weights to rank sections, pulling only top-N by score. No ML — just a weighted lookup that improves from real outcomes.

---

## Impact on Council Mode

V1 Council Mode cost: 5 agents × full memory files = large per-round context.  
With semantic retrieval: 5 agents × task-relevant sections only = 50-70% reduction per agent.  
Council Mode becomes practical at scale without hitting local model context limits.

---

## Implementation Notes

- **Phase 1** (build now): Static keyword→section rules in `memory-retrieval.ts`. Manual index.
- **Phase 2** (after 200+ scored tasks): Add `pack_memory_weights` table. Weekly weight update job.
- **Index maintenance:** Update `memory-index.md` when memory file structure changes significantly. Takes ~5 minutes.
- **Fallback:** If index is missing or section not found, fall back to full file push (v1 behavior). Never fail silently.

---

*Spec written: 2026-04-03 | Depends on: v1 live + real task patterns | Status: Ready to build after v1 validation*
