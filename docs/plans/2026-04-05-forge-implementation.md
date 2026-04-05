# Forge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Forge — an adversarial code reviewer agent for DenPack that reviews Sable's chunks, is scored by test outcomes, and self-improves via a Coywolf-approved checklist.

**Architecture:** Forge is a passive agent — never dispatched by tasks directly, only invoked by Arbor after every Sable chunk completion. It receives the chunk instruction + implementation, never the tests. Its verdict (APPROVE/REJECT) is compared against the test runner outcome to compute F1.

**Tech Stack:** TypeScript, Node.js ESM, OpenAI-compat client (LM Studio), Neon Postgres, same patterns as existing workers.

**Repo:** `/home/ubuntu/coywolf/repos/DenPack`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `workers/forge/seed.md` | Create | Forge's system prompt |
| `workers/forge/agent.ts` | Create | Forge worker — calls DeepSeek endpoint, parses verdict |
| `workers/forge/review-checklist.md` | Create | Starts empty, grows via self-improvement |
| `coordinator/rubrics/forge.json` | Create | Arbor rubric for scoring Forge's reviews |
| `db/schema.sql` | Modify | Add pack_forge_reviews + pack_forge_checklist_proposals tables |
| `coordinator/evaluator.ts` | Modify | Invoke Forge after Sable chunk, record (verdict, outcome) |
| `coordinator/dispatcher.ts` | Modify | Register forge in agent registry (non-routable) |
| `README.md` | Already updated | ✅ done |
| `specs/pack-agents/FORGE.md` | Already written | ✅ done |

---

## Task 1: Forge worker files

**Files:**
- Create: `workers/forge/seed.md`
- Create: `workers/forge/review-checklist.md`
- Create: `workers/forge/agent.ts`

- [ ] **Step 1: Write test**

Create `tests/forge/agent.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

// Mock the OpenAI client
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'VERDICT: APPROVE\nSCORE: 8\nISSUES:\n- [MINOR] small thing\nREASONING: looks good' } }],
          usage: { total_tokens: 100 }
        })
      }
    }
  }))
}));

describe('runForge', () => {
  it('parses APPROVE verdict correctly', async () => {
    const { runForge } = await import('../../workers/forge/agent.js');
    const result = await runForge({
      taskId: 'test-1',
      chunkInstruction: 'Write a function that adds two numbers',
      implementation: 'function add(a, b) { return a + b; }',
      modifiedFiles: ['src/math.ts'],
      memoryDir: '/tmp'
    });
    expect(result.verdict).toBe('APPROVE');
    expect(result.score).toBe(8);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe('MINOR');
  });

  it('parses REJECT verdict correctly', async () => {
    const { runForge } = await import('../../workers/forge/agent.js');
    // Override mock for this test
    const openai = (await import('openai')).default as ReturnType<typeof vi.fn>;
    openai.mockImplementationOnce(() => ({
      chat: { completions: { create: vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'VERDICT: REJECT\nSCORE: 3\nISSUES:\n- [CRITICAL] missing null check\nREASONING: will crash on null input' } }],
        usage: { total_tokens: 80 }
      }) } }
    }));
    const result = await runForge({
      taskId: 'test-2',
      chunkInstruction: 'Handle null input',
      implementation: 'function f(x) { return x.value; }',
      modifiedFiles: ['src/f.ts'],
      memoryDir: '/tmp'
    });
    expect(result.verdict).toBe('REJECT');
    expect(result.score).toBe(3);
    expect(result.issues[0].severity).toBe('CRITICAL');
  });

  it('defaults to REJECT on unparseable output', async () => {
    const { runForge } = await import('../../workers/forge/agent.js');
    const openai = (await import('openai')).default as ReturnType<typeof vi.fn>;
    openai.mockImplementationOnce(() => ({
      chat: { completions: { create: vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'I cannot determine the verdict' } }],
        usage: { total_tokens: 20 }
      }) } }
    }));
    const result = await runForge({
      taskId: 'test-3',
      chunkInstruction: 'anything',
      implementation: 'anything',
      modifiedFiles: [],
      memoryDir: '/tmp'
    });
    expect(result.verdict).toBe('REJECT');
    expect(result.parseError).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**
```bash
cd /home/ubuntu/coywolf/repos/DenPack
npx vitest run tests/forge/agent.test.ts 2>&1 | tail -20
```
Expected: FAIL — `workers/forge/agent.js` does not exist.

- [ ] **Step 3: Create seed.md**

`workers/forge/seed.md` — copy verbatim from `specs/pack-agents/FORGE.md` "Seed Prompt" section:

```markdown
# Forge

You are Forge, an adversarial code reviewer. Your job is to find what the implementer missed.

You will receive:
- The chunk instruction (what was asked)
- The implementation (what was produced)
- The file(s) modified

You will NOT receive the tests. You must evaluate the implementation on its own merits.

Review for:
1. CORRECTNESS — does the implementation actually do what was asked? Check edge cases, error handling, off-by-ones, type mismatches.
2. INTERFACE CLEANLINESS — will the next chunk be able to build on this without surprises? Hidden state, side effects, implicit assumptions.
3. SCOPE — did the implementer do more or less than asked? Both are problems.
4. OBVIOUS BUGS — anything that will fail immediately in use.

Output format (strict):
VERDICT: APPROVE | REJECT
SCORE: 1-10
ISSUES:
- [CRITICAL] description (use for: wrong behavior, will break tests)
- [IMPORTANT] description (use for: likely to cause problems downstream)
- [MINOR] description (use for: style, non-blocking)
REASONING: one paragraph

If REJECT: list at least one CRITICAL issue. Don't reject without specifics.
If APPROVE with score < 8: list the IMPORTANT issues that kept it from scoring higher.
```

- [ ] **Step 4: Create review-checklist.md**

```markdown
# Forge Review Checklist

Auto-generated entries appear below as Arbor approves Forge's self-improvement proposals.

<!-- entries added here by Arbor after Coywolf approval -->
```

- [ ] **Step 5: Create agent.ts**

```typescript
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: process.env.FORGE_MODEL_URL ?? process.env.LMSTUDIO_BASE_URL ?? 'http://localhost:1234/v1',
  apiKey: 'lmstudio',
});

const MODEL = process.env.FORGE_MODEL ?? 'deepseek-coder-v2-lite-instruct';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED = readFileSync(join(__dirname, 'seed.md'), 'utf8');

export interface ForgeInput {
  taskId: string;
  chunkInstruction: string;
  implementation: string;
  modifiedFiles: string[];
  memoryDir: string;
}

export interface ForgeIssue {
  severity: 'CRITICAL' | 'IMPORTANT' | 'MINOR';
  description: string;
}

export interface ForgeOutput {
  taskId: string;
  verdict: 'APPROVE' | 'REJECT';
  score: number;
  issues: ForgeIssue[];
  reasoning: string;
  tokenCount: number;
  parseError?: boolean;
}

function parseVerdict(text: string): ForgeOutput | null {
  const verdictMatch = text.match(/VERDICT:\s*(APPROVE|REJECT)/i);
  const scoreMatch = text.match(/SCORE:\s*(\d+)/i);
  const reasoningMatch = text.match(/REASONING:\s*([\s\S]+?)(?:\n\n|$)/i);

  if (!verdictMatch) return null;

  const issueMatches = [...text.matchAll(/- \[(CRITICAL|IMPORTANT|MINOR)\]\s*(.+)/gi)];
  const issues: ForgeIssue[] = issueMatches.map(m => ({
    severity: m[1].toUpperCase() as ForgeIssue['severity'],
    description: m[2].trim(),
  }));

  return {
    taskId: '',
    verdict: verdictMatch[1].toUpperCase() as 'APPROVE' | 'REJECT',
    score: scoreMatch ? Math.min(10, Math.max(1, parseInt(scoreMatch[1]))) : 5,
    issues,
    reasoning: reasoningMatch?.[1]?.trim() ?? '',
    tokenCount: 0,
  };
}

export async function runForge(input: ForgeInput): Promise<ForgeOutput> {
  const checklist = (() => {
    try {
      return readFileSync(join(__dirname, 'review-checklist.md'), 'utf8');
    } catch {
      return '';
    }
  })();

  const userMessage = [
    `## Chunk Instruction`,
    input.chunkInstruction,
    `## Modified Files`,
    input.modifiedFiles.join(', ') || '(none listed)',
    `## Implementation`,
    '```',
    input.implementation,
    '```',
    checklist ? `## Additional Review Checklist\n${checklist}` : '',
  ].filter(Boolean).join('\n\n');

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: SEED },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.2,
    max_tokens: 1000,
  });

  const text = response.choices[0]?.message?.content ?? '';
  const tokenCount = response.usage?.total_tokens ?? 0;
  const parsed = parseVerdict(text);

  if (!parsed) {
    return {
      taskId: input.taskId,
      verdict: 'REJECT',
      score: 1,
      issues: [{ severity: 'CRITICAL', description: 'Forge could not parse its own output — treating as rejection' }],
      reasoning: text,
      tokenCount,
      parseError: true,
    };
  }

  return { ...parsed, taskId: input.taskId, tokenCount };
}
```

- [ ] **Step 6: Run tests — verify they pass**
```bash
cd /home/ubuntu/coywolf/repos/DenPack
npx vitest run tests/forge/agent.test.ts 2>&1 | tail -20
```
Expected: 3 tests passing.

- [ ] **Step 7: Commit**
```bash
git add workers/forge/ tests/forge/
git commit -m "feat(forge): worker agent — verdict parsing, checklist injection, parse-error safety"
```

---

## Task 2: Database schema

**Files:**
- Modify: `db/schema.sql`

- [ ] **Step 1: Write test**

Create `tests/forge/schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('forge schema', () => {
  const schema = readFileSync('db/schema.sql', 'utf8');

  it('contains pack_forge_reviews table', () => {
    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS pack_forge_reviews/);
  });

  it('contains required columns in pack_forge_reviews', () => {
    expect(schema).toMatch(/verdict\s+TEXT/);
    expect(schema).toMatch(/test_outcome\s+TEXT/);
    expect(schema).toMatch(/label\s+TEXT/);
    expect(schema).toMatch(/f1_rolling\s+FLOAT/);
  });

  it('contains pack_forge_checklist_proposals table', () => {
    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS pack_forge_checklist_proposals/);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**
```bash
npx vitest run tests/forge/schema.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Add tables to schema.sql**

Append to `db/schema.sql`:

```sql
-- pack_forge_reviews: Forge verdict history scored against test outcomes
CREATE TABLE IF NOT EXISTS pack_forge_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewed_at TIMESTAMPTZ DEFAULT now(),
  chunk_id TEXT NOT NULL,
  sable_run_id TEXT,
  verdict TEXT CHECK (verdict IN ('APPROVE', 'REJECT')),
  score INTEGER CHECK (score BETWEEN 1 AND 10),
  issues JSONB,
  reasoning TEXT,
  token_count INTEGER,
  parse_error BOOLEAN DEFAULT false,
  test_outcome TEXT CHECK (test_outcome IN ('pass', 'fail', 'pending')),
  label TEXT CHECK (label IN ('true_positive', 'true_negative', 'false_negative', 'false_positive')),
  f1_rolling FLOAT
);

-- pack_forge_checklist_proposals: Forge self-improvement proposals
CREATE TABLE IF NOT EXISTS pack_forge_checklist_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_at TIMESTAMPTZ DEFAULT now(),
  trigger_false_negatives JSONB,
  proposal TEXT NOT NULL,
  approved BOOLEAN,
  approved_by TEXT DEFAULT 'coywolf',
  applied_at TIMESTAMPTZ
);
```

- [ ] **Step 4: Run test — verify it passes**
```bash
npx vitest run tests/forge/schema.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Apply migration to Neon**
```bash
node -e "
import('@neondatabase/serverless').then(async ({neon}) => {
  const sql = neon(process.env.DATABASE_URL);
  const schema = (await import('fs')).readFileSync('db/schema.sql', 'utf8');
  const forgeBlocks = schema.split('-- pack_forge').slice(1).map(b => '-- pack_forge' + b);
  for (const block of forgeBlocks) {
    await sql(block);
    console.log('Applied:', block.split('\n')[0]);
  }
})
" 2>&1 | head -10
```

- [ ] **Step 6: Commit**
```bash
git add db/schema.sql tests/forge/schema.test.ts
git commit -m "feat(forge): db schema — pack_forge_reviews + pack_forge_checklist_proposals"
```

---

## Task 3: Evaluator integration

**Files:**
- Modify: `coordinator/evaluator.ts`
- Create: `coordinator/rubrics/forge.json`

- [ ] **Step 1: Write test**

Create `tests/forge/evaluator-integration.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../workers/forge/agent.js', () => ({
  runForge: vi.fn().mockResolvedValue({
    taskId: 'test-1',
    verdict: 'APPROVE',
    score: 8,
    issues: [],
    reasoning: 'looks good',
    tokenCount: 100,
  })
}));

vi.mock('../db/client.js', () => ({
  default: Object.assign(
    vi.fn().mockResolvedValue([]),
    { query: vi.fn() }
  )
}));

describe('evaluator forge integration', () => {
  it('exports runForgeReview function', async () => {
    const mod = await import('../../coordinator/evaluator.js');
    expect(typeof mod.runForgeReview).toBe('function');
  });

  it('runForgeReview calls runForge and returns ForgeOutput', async () => {
    const { runForgeReview } = await import('../../coordinator/evaluator.js');
    const result = await runForgeReview({
      taskId: 'test-1',
      chunkInstruction: 'Write add()',
      implementation: 'function add(a,b){return a+b}',
      modifiedFiles: ['src/math.ts'],
      memoryDir: '/tmp',
    });
    expect(result.verdict).toBe('APPROVE');
    expect(result.score).toBe(8);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**
```bash
npx vitest run tests/forge/evaluator-integration.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Create forge rubric**

`coordinator/rubrics/forge.json`:
```json
{
  "domain": "forge",
  "criteria": [
    { "name": "verdict_given", "weight": 0.3, "signal": "VERDICT: present in output" },
    { "name": "score_given", "weight": 0.2, "signal": "SCORE: integer 1-10 present" },
    { "name": "issues_specific", "weight": 0.3, "signal": "at least one [SEVERITY] issue listed" },
    { "name": "reasoning_present", "weight": 0.2, "signal": "REASONING: non-empty paragraph" }
  ]
}
```

- [ ] **Step 4: Add runForgeReview to evaluator.ts**

Add to the bottom of `coordinator/evaluator.ts` (before closing):

```typescript
import { runForge, type ForgeInput, type ForgeOutput } from '../workers/forge/agent.js';

export async function runForgeReview(input: ForgeInput): Promise<ForgeOutput> {
  const result = await runForge(input);

  // Persist to DB (non-fatal if it fails)
  try {
    await sql`
      INSERT INTO pack_forge_reviews
        (chunk_id, verdict, score, issues, reasoning, token_count, parse_error, test_outcome)
      VALUES
        (${input.taskId}, ${result.verdict}, ${result.score}, ${JSON.stringify(result.issues)},
         ${result.reasoning}, ${result.tokenCount}, ${result.parseError ?? false}, 'pending')
    `;
  } catch (err) {
    console.error('[evaluator] forge db write failed:', err);
  }

  return result;
}

export async function recordForgeOutcome(chunkId: string, testOutcome: 'pass' | 'fail'): Promise<void> {
  // Fetch latest review for this chunk
  const rows = await sql`
    SELECT id, verdict FROM pack_forge_reviews
    WHERE chunk_id = ${chunkId} AND test_outcome = 'pending'
    ORDER BY reviewed_at DESC LIMIT 1
  `;
  if (!rows.length) return;

  const { id, verdict } = rows[0] as { id: string; verdict: string };
  const label =
    verdict === 'APPROVE' && testOutcome === 'pass' ? 'true_positive' :
    verdict === 'REJECT'  && testOutcome === 'fail' ? 'true_negative' :
    verdict === 'APPROVE' && testOutcome === 'fail' ? 'false_negative' :
    'false_positive';

  // Compute rolling F1
  const history = await sql`
    SELECT label FROM pack_forge_reviews
    WHERE label IS NOT NULL
    ORDER BY reviewed_at DESC LIMIT 50
  ` as { label: string }[];

  const tp = history.filter(r => r.label === 'true_positive').length;
  const fp = history.filter(r => r.label === 'false_positive').length;
  const fn = history.filter(r => r.label === 'false_negative').length;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall    = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  await sql`
    UPDATE pack_forge_reviews
    SET test_outcome = ${testOutcome}, label = ${label}, f1_rolling = ${f1}
    WHERE id = ${id}
  `;
}
```

- [ ] **Step 5: Run test — verify it passes**
```bash
npx vitest run tests/forge/evaluator-integration.test.ts 2>&1 | tail -10
```

- [ ] **Step 6: Run full test suite — no regressions**
```bash
npx vitest run 2>&1 | tail -20
```

- [ ] **Step 7: Commit**
```bash
git add coordinator/evaluator.ts coordinator/rubrics/forge.json tests/forge/evaluator-integration.test.ts
git commit -m "feat(forge): evaluator integration — runForgeReview + recordForgeOutcome + F1 tracking"
```

---

## Task 4: Dispatcher registration + env config

**Files:**
- Modify: `coordinator/dispatcher.ts`
- Modify: `.env.example` (if exists) or create note in README

- [ ] **Step 1: Write test**

Create `tests/forge/dispatcher.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('dispatcher forge registration', () => {
  it('forge is not in any routable domain', () => {
    const src = readFileSync('coordinator/dispatcher.ts', 'utf8');
    // forge should appear in agent registry but NOT in DOMAIN_AGENT_MAP values
    expect(src).toMatch(/forge/);
    expect(src).not.toMatch(/['"]forge['"]\s*(?:,|\])/); // not in domain arrays
  });
});
```

- [ ] **Step 2: Run test — verify it fails**
```bash
npx vitest run tests/forge/dispatcher.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Add forge to dispatcher registry comment**

In `coordinator/dispatcher.ts`, add comment block after the DOMAIN_AGENT_MAP:

```typescript
// Non-routable agents (invoked by Arbor internally, not by task domain):
// - forge: invoked by evaluator after every Sable chunk. Never in DOMAIN_AGENT_MAP.
```

Also add to pack_agent_profiles upsert if one exists in the file:

```typescript
// Forge model env: FORGE_MODEL (default: deepseek-coder-v2-lite-instruct)
// Forge endpoint: FORGE_MODEL_URL (default: LMSTUDIO_BASE_URL)
```

- [ ] **Step 4: Run test — passes**
```bash
npx vitest run tests/forge/dispatcher.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Commit**
```bash
git add coordinator/dispatcher.ts tests/forge/dispatcher.test.ts
git commit -m "feat(forge): register as non-routable agent in dispatcher"
```

---

## Task 5: Final wiring — push and verify build

- [ ] **Step 1: Full test suite**
```bash
npx vitest run 2>&1 | tail -30
```
Expected: all tests pass, 0 regressions.

- [ ] **Step 2: TypeScript compile check**
```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 3: Push**
```bash
git push origin main
```

- [ ] **Step 4: Report status**
All files created, tests passing, compiled clean, pushed to GitHub.
