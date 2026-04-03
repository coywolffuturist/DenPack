# DenPack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build DenPack — a local AI pack system with Arbor (coordinator/evaluator) + 5 workers (Lumen, Vex, Mira, Coda, Sable) running on the Coywolf Den, handling 70-80% of daily task volume locally.

**Architecture:** Router on VPS classifies incoming tasks and dispatches to local pack or Coywolf. Arbor (Gemma 4 E4B on Den) coordinates workers, syncs memory from VPS at task start, and scores results. Workers (Gemma 4 26B MoE) have co-located tools + memory — no round trips for tool calls.

**Tech Stack:** TypeScript (Node.js 22), Neon Postgres (pg), LM Studio REST API (OpenAI-compatible), SSH/rsync for memory sync, `gh` CLI on Den, Zod for validation.

---

## File Map

```
DenPack/
  router/
    index.ts          — Express server on VPS: receives tasks, classifies, dispatches
    classifier.ts     — Rule-based + LLM task classification
    search-proxy.ts   — Intercepts web_search, routes to Den browser
    types.ts          — Shared types: Task, Route, ClassificationResult
  coordinator/
    index.ts          — Arbor main loop: receive → dispatch → collect → score → return
    dispatcher.ts     — Select best worker from pack_agent_profiles
    evaluator.ts      — Score task output (correctness, efficiency, handoff)
    synthesizer.ts    — Format final response for Clawdbot gateway
    memory-sync.ts    — rsync relevant .md files from VPS to agent working dirs
    types.ts          — Coordinator types: AgentProfile, Score, TaskAssignment
  workers/
    base-agent.ts     — Base worker class: receive task, run local LLM, emit tool calls, return output
    tool-runtime.ts   — Local tool execution: gh, browser, neon, exec, read_memory
    lumen/
      agent.ts        — Lumen: Prowl executor (extends base-agent)
      seed.md         — Lumen system prompt seed + objective
    vex/
      agent.ts        — Vex: Prowl strategist/backtester
      seed.md         — Vex system prompt seed
    mira/
      agent.ts        — Mira: Research
      seed.md         — Mira system prompt seed
    coda/
      agent.ts        — Coda: Report synthesis
      seed.md         — Coda system prompt seed
    sable/
      agent.ts        — Sable: Lucid builder
      seed.md         — Sable system prompt seed
  db/
    schema.sql        — pack_tasks, pack_agent_profiles, pack_scores tables
    client.ts         — Neon Postgres client (shared)
    migrations/
      001-initial.sql — Initial schema migration
  scripts/
    setup-den.sh      — Install gh, neon client, browser wiring on Den
    start-pack.sh     — Launch Arbor + all workers
    status.sh         — Health check: models loaded, workers running, Neon reachable
    memory-push.sh    — Manual memory snapshot push to Den
  package.json
  tsconfig.json
  .env.example
```

---

## Task 1: Project scaffold + Neon schema

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `db/schema.sql`
- Create: `db/migrations/001-initial.sql`
- Create: `db/client.ts`

- [ ] **Step 1: Init package.json**
```bash
cd /home/ubuntu/coywolf/repos/DenPack/.worktrees/build-v1
cat > package.json << 'EOF'
{
  "name": "denpack",
  "version": "0.1.0",
  "description": "Local AI pack — Arbor + Lumen/Vex/Mira/Coda/Sable",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "router": "node --experimental-strip-types router/index.ts",
    "coordinator": "node --experimental-strip-types coordinator/index.ts",
    "status": "bash scripts/status.sh"
  },
  "dependencies": {
    "@neondatabase/serverless": "^0.10.4",
    "express": "^4.21.2",
    "openai": "^4.87.0",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/express": "^5.0.1",
    "@types/node": "^22.14.0",
    "typescript": "^5.8.3"
  }
}
EOF
npm install
```
- [ ] **Step 2: tsconfig.json**
```bash
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist", ".worktrees"]
}
EOF
```
- [ ] **Step 3: .env.example**
```bash
cat > .env.example << 'EOF'
# Neon Postgres
NEON_DATABASE_URL=postgresql://...

# LM Studio (Den, tunneled to VPS on :1234)
LMSTUDIO_BASE_URL=http://localhost:1234/v1

# Models
ARBOR_MODEL=gemma-4-e4b-it-mlx
WORKER_MODEL_PRIMARY=gemma-4-26b-a4b-it
WORKER_MODEL_CODER=qwen2.5-coder-7b-instruct-mlx

# VPS memory source (for sync)
VPS_MEMORY_PATH=/home/ubuntu/coywolf/memory

# Den working directory for agent memory snapshots
DEN_AGENT_WORKDIR=/Users/coywolfden/.denpack/agents

# Escalation threshold
ESCALATION_SCORE_THRESHOLD=6.0
EOF
```
- [ ] **Step 4: Write db/schema.sql**
```sql
-- pack_tasks: task queue
CREATE TABLE IF NOT EXISTS pack_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'pending',   -- pending | assigned | complete | failed | escalated
  domain TEXT NOT NULL,            -- prowl | research | lucid | general
  input JSONB NOT NULL,
  assigned_to TEXT,                -- agent name: lumen | vex | mira | coda | sable
  output JSONB,
  score JSONB,                     -- {correctness, efficiency, handoff, composite}
  escalated BOOLEAN DEFAULT false
);

-- pack_agent_profiles: running performance per agent
CREATE TABLE IF NOT EXISTS pack_agent_profiles (
  agent_id TEXT PRIMARY KEY,       -- lumen | vex | mira | coda | sable
  model TEXT NOT NULL,
  scores_by_domain JSONB DEFAULT '{}',
  total_tasks INTEGER DEFAULT 0,
  avg_composite_score FLOAT DEFAULT 0,
  last_active TIMESTAMPTZ
);

-- pack_scores: full score history for trend analysis
CREATE TABLE IF NOT EXISTS pack_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES pack_tasks(id),
  agent_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  correctness FLOAT NOT NULL,
  efficiency FLOAT NOT NULL,
  handoff FLOAT NOT NULL,
  composite FLOAT NOT NULL,
  scored_at TIMESTAMPTZ DEFAULT now()
);
```
- [ ] **Step 5: Write db/client.ts**
```typescript
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL!);
export default sql;

export async function runMigrations() {
  const { readFile } = await import('fs/promises');
  const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  await sql(schema);
  console.log('Migrations complete.');
}
```
- [ ] **Step 6: Commit**
```bash
git add . && git commit -m "feat: scaffold + Neon schema"
```

---

## Task 2: Shared types

**Files:**
- Create: `router/types.ts`
- Create: `coordinator/types.ts`

- [ ] **Step 1: router/types.ts**
```typescript
import { z } from 'zod';

export const DomainSchema = z.enum(['prowl', 'research', 'lucid', 'general']);
export type Domain = z.infer<typeof DomainSchema>;

export const RouteSchema = z.enum(['local', 'coywolf']);
export type Route = z.infer<typeof RouteSchema>;

export const IncomingTaskSchema = z.object({
  id: z.string().uuid().optional(),
  message: z.string(),
  context: z.record(z.unknown()).optional(),
  sessionKey: z.string().optional(),
});
export type IncomingTask = z.infer<typeof IncomingTaskSchema>;

export const ClassificationResultSchema = z.object({
  route: RouteSchema,
  domain: DomainSchema,
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});
export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;
```

- [ ] **Step 2: coordinator/types.ts**
```typescript
export type AgentName = 'lumen' | 'vex' | 'mira' | 'coda' | 'sable';

export interface AgentProfile {
  agent_id: AgentName;
  model: string;
  scores_by_domain: Record<string, number>;
  total_tasks: number;
  avg_composite_score: number;
  last_active: string | null;
}

export interface Score {
  correctness: number;
  efficiency: number;
  handoff: number;
  composite: number;
}

export interface TaskAssignment {
  taskId: string;
  agent: AgentName;
  domain: string;
  input: unknown;
  memoryFiles: string[];
}

export interface TaskResult {
  taskId: string;
  agent: AgentName;
  output: string;
  toolCallCount: number;
  tokenCount: number;
}
```

- [ ] **Step 3: Commit**
```bash
git add . && git commit -m "feat: shared types for router and coordinator"
```

---

## Task 3: Memory sync

**Files:**
- Create: `coordinator/memory-sync.ts`
- Create: `scripts/memory-push.sh`

- [ ] **Step 1: Write coordinator/memory-sync.ts**
```typescript
import { execSync } from 'child_process';
import { mkdirSync } from 'fs';
import path from 'path';

const VPS_MEMORY = process.env.VPS_MEMORY_PATH ?? '/home/ubuntu/coywolf/memory';
const DEN_WORKDIR = process.env.DEN_AGENT_WORKDIR ?? '/Users/coywolfden/.denpack/agents';

// Files each agent receives at task dispatch
const AGENT_MEMORY_FILES: Record<string, string[]> = {
  lumen: ['entities/prowl-strategies.md', 'PROJECTS.md'],
  vex:   ['entities/prowl-strategies.md', 'reference/GOALS.md'],
  mira:  ['PROJECTS.md', 'reference/GOALS.md', 'entities/Brendan-Joyce.md'],
  coda:  ['PROJECTS.md', 'reference/GOALS.md'],
  sable: ['PROJECTS.md', 'entities/coywolf repo.md'],
};

export async function syncMemoryForAgent(agent: string): Promise<string> {
  const files = AGENT_MEMORY_FILES[agent] ?? [];
  const agentDir = path.join(DEN_WORKDIR, agent, 'memory');
  mkdirSync(agentDir, { recursive: true });

  for (const file of files) {
    const src = path.join(VPS_MEMORY, file);
    const dst = path.join(agentDir, path.basename(file));
    try {
      execSync(`cp "${src}" "${dst}"`, { stdio: 'pipe' });
    } catch {
      console.warn(`memory-sync: could not copy ${file} — skipping`);
    }
  }

  return agentDir;
}
```

- [ ] **Step 2: scripts/memory-push.sh**
```bash
#!/usr/bin/env bash
# Push memory snapshot to Den for a specific agent
# Usage: ./scripts/memory-push.sh <agent>
set -euo pipefail
AGENT=${1:-all}
DEN_USER=coywolfden
DEN_HOST=localhost
DEN_PORT=2222
DEN_WORKDIR=/Users/coywolfden/.denpack/agents
VPS_MEMORY=/home/ubuntu/coywolf/memory

push_agent() {
  local agent=$1
  echo "Pushing memory for $agent..."
  ssh -p $DEN_PORT $DEN_USER@$DEN_HOST "mkdir -p $DEN_WORKDIR/$agent/memory"
  case $agent in
    lumen|vex)
      rsync -az -e "ssh -p $DEN_PORT" \
        $VPS_MEMORY/entities/prowl-strategies.md \
        $VPS_MEMORY/PROJECTS.md \
        $DEN_USER@$DEN_HOST:$DEN_WORKDIR/$agent/memory/
      ;;
    mira|coda)
      rsync -az -e "ssh -p $DEN_PORT" \
        $VPS_MEMORY/PROJECTS.md \
        $VPS_MEMORY/reference/GOALS.md \
        $DEN_USER@$DEN_HOST:$DEN_WORKDIR/$agent/memory/
      ;;
    sable)
      rsync -az -e "ssh -p $DEN_PORT" \
        $VPS_MEMORY/PROJECTS.md \
        $DEN_USER@$DEN_HOST:$DEN_WORKDIR/$agent/memory/
      ;;
  esac
  echo "$agent memory synced."
}

if [ "$AGENT" = "all" ]; then
  for a in lumen vex mira coda sable; do push_agent $a; done
else
  push_agent $AGENT
fi
```

- [ ] **Step 3: Commit**
```bash
chmod +x scripts/memory-push.sh
git add . && git commit -m "feat: memory sync — push VPS .md files to Den agent dirs"
```

---

## Task 4: Worker base + tool runtime

**Files:**
- Create: `workers/tool-runtime.ts`
- Create: `workers/base-agent.ts`

- [ ] **Step 1: workers/tool-runtime.ts**
```typescript
import { execSync, execFileSync } from 'child_process';

export type ToolCall = {
  tool: 'exec' | 'gh' | 'read_memory' | 'browser_search' | 'neon_query';
  [key: string]: unknown;
};

export type ToolResult = { success: boolean; output: string };

export async function executeTool(call: ToolCall, memoryDir: string): Promise<ToolResult> {
  try {
    switch (call.tool) {
      case 'exec': {
        const out = execSync(String(call.command), { encoding: 'utf8', timeout: 30000 });
        return { success: true, output: out };
      }
      case 'gh': {
        const args = (call.args as string[]) ?? [];
        const out = execFileSync('gh', args, { encoding: 'utf8', timeout: 30000 });
        return { success: true, output: out };
      }
      case 'read_memory': {
        const { readFileSync } = await import('fs');
        const p = `${memoryDir}/${call.file}`;
        return { success: true, output: readFileSync(p, 'utf8') };
      }
      case 'browser_search': {
        // Calls Den Chrome CDP search — stubbed; full impl in search-proxy
        return { success: false, output: 'browser_search: not yet implemented' };
      }
      case 'neon_query': {
        // Direct Neon query from Den — requires NEON_DATABASE_URL on Den
        const sql = (await import('../db/client.js')).default;
        const rows = await sql(call.query as string);
        return { success: true, output: JSON.stringify(rows) };
      }
      default:
        return { success: false, output: `Unknown tool: ${(call as ToolCall).tool}` };
    }
  } catch (err) {
    return { success: false, output: String(err) };
  }
}
```

- [ ] **Step 2: workers/base-agent.ts**
```typescript
import OpenAI from 'openai';
import { executeTool, type ToolCall } from './tool-runtime.js';

const client = new OpenAI({ baseURL: process.env.LMSTUDIO_BASE_URL, apiKey: 'lmstudio' });

export interface AgentTask {
  taskId: string;
  domain: string;
  input: string;
  memoryDir: string;
  systemPrompt: string;
  model: string;
}

export interface AgentOutput {
  taskId: string;
  output: string;
  toolCallCount: number;
  tokenCount: number;
}

export async function runAgent(task: AgentTask): Promise<AgentOutput> {
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: task.systemPrompt },
    { role: 'user', content: task.input },
  ];

  let toolCallCount = 0;
  let totalTokens = 0;
  const MAX_TURNS = 10;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await client.chat.completions.create({
      model: task.model,
      messages,
      max_tokens: 4096,
    });

    const choice = resp.choices[0];
    totalTokens += resp.usage?.total_tokens ?? 0;
    const content = choice.message.content ?? '';
    messages.push({ role: 'assistant', content });

    // Check for tool call JSON blocks
    const toolMatch = content.match(/```tool\n([\s\S]+?)\n```/);
    if (!toolMatch || choice.finish_reason === 'stop') {
      return { taskId: task.taskId, output: content, toolCallCount, tokenCount: totalTokens };
    }

    const toolCall = JSON.parse(toolMatch[1]) as ToolCall;
    toolCallCount++;
    const result = await executeTool(toolCall, task.memoryDir);
    messages.push({ role: 'user', content: `Tool result:\n${result.output}` });
  }

  return {
    taskId: task.taskId,
    output: messages[messages.length - 1].content as string,
    toolCallCount,
    tokenCount: totalTokens,
  };
}
```

- [ ] **Step 3: Commit**
```bash
git add . && git commit -m "feat: worker base agent + local tool runtime"
```

---

## Task 5: Worker seed prompts + agent wrappers

**Files:**
- Create: `workers/lumen/seed.md` + `agent.ts`
- Create: `workers/vex/seed.md` + `agent.ts`
- Create: `workers/mira/seed.md` + `agent.ts`
- Create: `workers/coda/seed.md` + `agent.ts`
- Create: `workers/sable/seed.md` + `agent.ts`

- [ ] **Step 1: Lumen seed + agent**
```bash
mkdir -p workers/lumen workers/vex workers/mira workers/coda workers/sable
```
`workers/lumen/seed.md`:
```markdown
# Lumen

You are Lumen, a Prowl strategy executor. Your objective is to execute and monitor active Prowl strategies reliably with 24/7 uptime.

## Memory
Your memory directory contains:
- `prowl-strategies.md` — active strategies, parameters, risk rules
- `PROJECTS.md` — project context

## Tools
Use tool calls in ```tool blocks:
```tool
{"tool": "read_memory", "file": "prowl-strategies.md"}
```
Available: exec, gh, read_memory, neon_query

## Rules
- Always read prowl-strategies.md before executing anything
- Never exceed position limits defined in strategy params
- Log every execution to Neon via neon_query
- If uncertain: stop and return your reasoning, do not guess
```

`workers/lumen/agent.ts`:
```typescript
import { readFileSync } from 'fs';
import path from 'path';
import { runAgent, type AgentTask, type AgentOutput } from '../base-agent.js';

const MODEL = process.env.WORKER_MODEL_PRIMARY ?? 'gemma-4-26b-a4b-it';
const SEED = readFileSync(new URL('./seed.md', import.meta.url), 'utf8');

export async function runLumen(task: Omit<AgentTask, 'systemPrompt' | 'model'>): Promise<AgentOutput> {
  return runAgent({ ...task, systemPrompt: SEED, model: MODEL });
}
```

- [ ] **Step 2: Vex, Mira, Coda, Sable — same pattern**
  Each gets a `seed.md` with its specific objective and a minimal `agent.ts` wrapping `runAgent`. Seed objectives:
  - **Vex**: Develop and backtest Prowl strategies. Adversarial — find what breaks.
  - **Mira**: Deep research synthesis. Find sources, cross-reference, surface signal.
  - **Coda**: Take Mira's research output, write clean reports. Close the loop.
  - **Sable**: Lucid feature implementation. Read the issue, write tests first, implement, PR.

- [ ] **Step 3: Commit**
```bash
git add . && git commit -m "feat: all 5 worker seed prompts + agent wrappers"
```

---

## Task 6: Arbor — dispatcher + evaluator + synthesizer

**Files:**
- Create: `coordinator/dispatcher.ts`
- Create: `coordinator/evaluator.ts`
- Create: `coordinator/synthesizer.ts`

- [ ] **Step 1: dispatcher.ts**
```typescript
import sql from '../db/client.js';
import type { AgentName } from './types.js';

const DOMAIN_AGENT_MAP: Record<string, AgentName[]> = {
  prowl:    ['lumen', 'vex'],
  research: ['mira', 'coda'],
  lucid:    ['sable'],
  general:  ['mira', 'lumen'],
};

export async function selectAgent(domain: string): Promise<AgentName> {
  const candidates = DOMAIN_AGENT_MAP[domain] ?? ['mira'];

  const rows = await sql`
    SELECT agent_id, scores_by_domain, avg_composite_score
    FROM pack_agent_profiles
    WHERE agent_id = ANY(${candidates})
    ORDER BY avg_composite_score DESC
    LIMIT 1
  `;

  if (rows.length > 0) return rows[0].agent_id as AgentName;
  // Default: first candidate (no profile yet = equal footing)
  return candidates[0];
}
```

- [ ] **Step 2: evaluator.ts**
```typescript
import type { TaskResult } from './types.js';
import type { Score } from './types.js';

const ESCALATION_THRESHOLD = parseFloat(process.env.ESCALATION_SCORE_THRESHOLD ?? '6.0');

export function scoreTask(result: TaskResult, expectedDomain: string): Score {
  // Correctness: heuristic — length + presence of domain keywords
  // In v1 this is rule-based; v2 will use Arbor (E4B) as judge
  const domainKeywords: Record<string, string[]> = {
    prowl:    ['strategy', 'position', 'executed', 'backtest', 'market'],
    research: ['sources', 'analysis', 'findings', 'conclusion', 'evidence'],
    lucid:    ['commit', 'test', 'function', 'component', 'pull request'],
    general:  [],
  };
  const keywords = domainKeywords[expectedDomain] ?? [];
  const outputLower = result.output.toLowerCase();
  const keywordHits = keywords.filter(k => outputLower.includes(k)).length;
  const correctness = keywords.length > 0 ? Math.min(10, (keywordHits / keywords.length) * 10) : 7;

  // Efficiency: penalize high tool call counts + token counts
  const efficiency = Math.max(0, 10 - Math.floor(result.toolCallCount / 2) - Math.floor(result.tokenCount / 2000));

  // Handoff: v1 default (will be scored by downstream agent in multi-hop tasks)
  const handoff = 8;

  const composite = (correctness * 0.6) + (efficiency * 0.2) + (handoff * 0.2);

  return { correctness, efficiency, handoff, composite };
}

export function shouldEscalate(score: Score): boolean {
  return score.composite < ESCALATION_THRESHOLD;
}
```

- [ ] **Step 3: synthesizer.ts**
```typescript
export function synthesizeResponse(output: string, agent: string, score: number): string {
  // Strip internal tool call blocks before returning to user
  const cleaned = output.replace(/```tool[\s\S]+?```/g, '').trim();
  return cleaned;
}
```

- [ ] **Step 4: Commit**
```bash
git add . && git commit -m "feat: Arbor dispatcher, evaluator, synthesizer"
```

---

## Task 7: Arbor coordinator main loop

**Files:**
- Create: `coordinator/index.ts`

- [ ] **Step 1: coordinator/index.ts**
```typescript
import sql from '../db/client.js';
import { selectAgent } from './dispatcher.js';
import { scoreTask, shouldEscalate } from './evaluator.js';
import { synthesizeResponse } from './synthesizer.js';
import { syncMemoryForAgent } from './memory-sync.js';
import { runLumen } from '../workers/lumen/agent.js';
import { runVex } from '../workers/vex/agent.js';
import { runMira } from '../workers/mira/agent.js';
import { runCoda } from '../workers/coda/agent.js';
import { runSable } from '../workers/sable/agent.js';
import type { AgentName, TaskResult } from './types.js';

const AGENT_RUNNERS: Record<AgentName, (t: any) => Promise<any>> = {
  lumen: runLumen, vex: runVex, mira: runMira, coda: runCoda, sable: runSable,
};

export async function handleTask(taskId: string, domain: string, input: string): Promise<string> {
  // 1. Select best agent
  const agent = await selectAgent(domain);

  // 2. Sync memory to Den for this agent
  const memoryDir = await syncMemoryForAgent(agent);

  // 3. Mark assigned
  await sql`UPDATE pack_tasks SET status='assigned', assigned_to=${agent} WHERE id=${taskId}::uuid`;

  // 4. Run agent
  const runner = AGENT_RUNNERS[agent];
  const result: TaskResult = await runner({ taskId, domain, input, memoryDir });

  // 5. Score
  const score = scoreTask(result, domain);

  // 6. Escalate if below threshold
  if (shouldEscalate(score)) {
    await sql`UPDATE pack_tasks SET status='escalated', score=${JSON.stringify(score)} WHERE id=${taskId}::uuid`;
    return '__ESCALATE__';
  }

  // 7. Store result + score
  await sql`
    UPDATE pack_tasks SET status='complete', output=${JSON.stringify({ text: result.output })},
    score=${JSON.stringify(score)} WHERE id=${taskId}::uuid
  `;
  await sql`
    INSERT INTO pack_scores (task_id, agent_id, domain, correctness, efficiency, handoff, composite)
    VALUES (${taskId}::uuid, ${agent}, ${domain}, ${score.correctness}, ${score.efficiency}, ${score.handoff}, ${score.composite})
  `;

  // 8. Update agent profile
  await sql`
    INSERT INTO pack_agent_profiles (agent_id, model, total_tasks, avg_composite_score, last_active)
    VALUES (${agent}, 'gemma-4-26b-a4b-it', 1, ${score.composite}, now())
    ON CONFLICT (agent_id) DO UPDATE SET
      total_tasks = pack_agent_profiles.total_tasks + 1,
      avg_composite_score = (pack_agent_profiles.avg_composite_score * pack_agent_profiles.total_tasks + ${score.composite}) / (pack_agent_profiles.total_tasks + 1),
      last_active = now()
  `;

  // 9. Synthesize + return
  return synthesizeResponse(result.output, agent, score.composite);
}
```

- [ ] **Step 2: Commit**
```bash
git add . && git commit -m "feat: Arbor coordinator main loop"
```

---

## Task 8: VPS Router

**Files:**
- Create: `router/types.ts` (done in Task 2)
- Create: `router/classifier.ts`
- Create: `router/search-proxy.ts`
- Create: `router/index.ts`

- [ ] **Step 1: router/classifier.ts**
```typescript
import type { ClassificationResult, Domain } from './types.js';

const PROWL_KEYWORDS = ['prowl', 'strategy', 'backtest', 'position', 'trade', 'market', 'bankroll'];
const RESEARCH_KEYWORDS = ['research', 'find', 'analyze', 'report', 'summarize', 'investigate'];
const LUCID_KEYWORDS = ['lucid', 'feature', 'build', 'implement', 'fix', 'pr', 'issue', 'code'];
const ESCALATE_KEYWORDS = ['ask coywolf', 'your opinion', 'what do you think', 'architecture decision'];

export function classifyTask(message: string): ClassificationResult {
  const lower = message.toLowerCase();

  if (ESCALATE_KEYWORDS.some(k => lower.includes(k))) {
    return { route: 'coywolf', domain: 'general', confidence: 0.95, reason: 'explicit escalation keyword' };
  }

  const scores: Record<Domain, number> = {
    prowl: PROWL_KEYWORDS.filter(k => lower.includes(k)).length,
    research: RESEARCH_KEYWORDS.filter(k => lower.includes(k)).length,
    lucid: LUCID_KEYWORDS.filter(k => lower.includes(k)).length,
    general: 1, // baseline
  };

  const domain = (Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0]) as Domain;
  const confidence = Math.min(0.95, scores[domain] / 5);

  return { route: 'local', domain, confidence, reason: `keyword match: ${domain}` };
}
```

- [ ] **Step 2: router/search-proxy.ts**
```typescript
// Intercepts web_search calls, routes to Den browser search via Chrome CDP
// Full implementation requires Den Chrome CDP endpoint — stub for now
export async function denBrowserSearch(query: string): Promise<string> {
  console.log(`[search-proxy] Routing to Den browser: "${query}"`);
  // TODO: implement Chrome CDP search on Den
  return `Search stub for: ${query}`;
}
```

- [ ] **Step 3: router/index.ts**
```typescript
import express from 'express';
import { classifyTask } from './classifier.js';
import { handleTask } from '../coordinator/index.js';
import sql from '../db/client.js';
import { v4 as uuidv4 } from 'uuid';
import { IncomingTaskSchema } from './types.js';

const app = express();
app.use(express.json());

app.post('/task', async (req, res) => {
  const parsed = IncomingTaskSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });

  const { message, context } = parsed.data;
  const classification = classifyTask(message);

  if (classification.route === 'coywolf') {
    return res.json({ route: 'coywolf', reason: classification.reason });
  }

  const taskId = uuidv4();
  await sql`
    INSERT INTO pack_tasks (id, domain, input) VALUES (${taskId}::uuid, ${classification.domain}, ${JSON.stringify({ message, context })})
  `;

  const result = await handleTask(taskId, classification.domain, message);

  if (result === '__ESCALATE__') {
    return res.json({ route: 'coywolf', reason: 'score below threshold', taskId });
  }

  return res.json({ route: 'local', result, taskId, domain: classification.domain });
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const PORT = process.env.ROUTER_PORT ?? 3847;
app.listen(PORT, () => console.log(`DenPack router listening on :${PORT}`));
```

- [ ] **Step 4: Add uuid dep**
```bash
npm install uuid && npm install -D @types/uuid
```

- [ ] **Step 5: Commit**
```bash
git add . && git commit -m "feat: VPS router — classify, queue, dispatch, escalate"
```

---

## Task 9: Den setup script

**Files:**
- Create: `scripts/setup-den.sh`
- Create: `scripts/start-pack.sh`
- Create: `scripts/status.sh`

- [ ] **Step 1: scripts/setup-den.sh**
```bash
#!/usr/bin/env bash
# Run on Den to install tool suite for pack workers
set -euo pipefail
echo "Setting up DenPack tool suite..."

# gh CLI
if ! command -v gh &>/dev/null; then
  brew install gh
fi
gh auth status || gh auth login

# Node.js (for neon client on Den)
if ! command -v node &>/dev/null; then
  brew install node
fi

# Create agent working dirs
mkdir -p ~/.denpack/agents/{lumen,vex,mira,coda,sable}/memory

# .env on Den
if [ ! -f ~/.denpack/.env ]; then
  echo "NEON_DATABASE_URL=<fill in>" > ~/.denpack/.env
  echo "LMSTUDIO_BASE_URL=http://localhost:1234/v1" >> ~/.denpack/.env
  echo "Created ~/.denpack/.env — fill in NEON_DATABASE_URL"
fi

echo "Den setup complete."
```

- [ ] **Step 2: scripts/start-pack.sh and status.sh**
```bash
# start-pack.sh
#!/usr/bin/env bash
echo "Starting DenPack router..."
node --experimental-strip-types router/index.ts &
echo "Router PID: $!"

# status.sh
#!/usr/bin/env bash
echo "=== DenPack Status ==="
curl -s http://localhost:3847/health && echo ""
curl -s http://localhost:1234/v1/models | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const m=JSON.parse(d).data.map(x=>x.id); console.log('Models:', m.join(', '))"
```

- [ ] **Step 3: Commit**
```bash
chmod +x scripts/*.sh
git add . && git commit -m "feat: Den setup + start/status scripts"
```

---

## Task 10: Final push + PR

- [ ] **Step 1: TypeScript build check**
```bash
npx tsc --noEmit 2>&1
```

- [ ] **Step 2: Push branch**
```bash
git push origin build/v1
```

- [ ] **Step 3: Open PR**
```bash
gh pr create --title "feat: DenPack v1 — Arbor + 5 workers + VPS router" \
  --body "Implements the full DenPack system per specs/system-design.md v1.1.
  
  - Arbor coordinator: dispatch, evaluate, synthesize
  - 5 workers: Lumen, Vex, Mira, Coda, Sable with co-located tools + memory
  - VPS router: classify, queue, escalate
  - Neon schema: pack_tasks, pack_agent_profiles, pack_scores
  - Memory sync: VPS → Den rsync at task dispatch
  - Den setup script: gh auth, agent dirs, .env" \
  --repo coywolffuturist/DenPack
```

- [ ] **Step 4: Post PR link to Brendan**

---

*Plan version: 1.0 | Written: 2026-04-03 | Status: Ready for subagent execution*
