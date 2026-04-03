# Local Pack System — Design Spec
*Version 1.0 — 2026-04-03*

---

## What

A local AI pack running on the Coywolf Den (Mac Mini M4 Pro, 64GB RAM) that handles 70-80% of daily task volume without hitting Anthropic. The pack uses a flat worker pool with emergent specialization, scored by a lightweight coordinator/evaluator. A router on the VPS classifies every incoming message and dispatches to the local pack or escalates to Coywolf (Anthropic) when genuinely needed.

---

## Why

1. **Cost** — $85/mo Brave Search + $10+/day Anthropic credits for tasks that don't need frontier reasoning. Target: reduce to <$2/day Anthropic spend.
2. **Sovereignty** — Pack runs while Anthropic is dark. Crons, Prowl, research continue 24/7.
3. **Compounding** — Pack improves through its own performance history. Emergent specialization without pre-assigned roles.
4. **Scale** — MiroFish-proven pattern: seed with objectives, let roles emerge from what agents repeatedly succeed at.

---

## Architecture

### Pack Roster

| Name | Role | Model |
|---|---|---|
| **Arbor** | Coordinator/Evaluator | Gemma 4 E4B (MLX 4-bit) |
| **Lumen** | Prowl executor | Gemma 4 26B MoE (MLX 4-bit) |
| **Vex** | Prowl strategist/backtester | Gemma 4 26B MoE (MLX 4-bit) |
| **Mira** | Research | Gemma 4 26B MoE (MLX 4-bit) or Qwen3.5-27B |
| **Coda** | Report synthesis | Gemma 4 26B MoE (MLX 4-bit) or Qwen3.5-27B |
| **Sable** | Lucid builder | Qwen2.5-Coder-7B (MLX 4-bit) |

### Model Stack

| Model | Role | Notes |
|---|---|---|
| `Gemma 4 E4B` (MLX 4-bit) | Arbor — Coordinator/Evaluator | Fast, always-on, ~2.5GB |
| `Gemma 4 26B MoE` (MLX 4-bit) | Lumen, Vex, primary Mira/Coda | ~5GB on disk, 4B active params |
| `Qwen2.5-Coder-7B` (MLX 4-bit) | Sable — Lucid coding agent | Stays specialized |
| `Qwen3.5-27B` (MLX 4-bit) | Retained worker (Mira/Coda alt) | Competes with Gemma 4 26B; Arbor scores both |

Gemma 4 26B MoE and Qwen3.5-27B compete in the worker pool for the first 2 weeks. Evaluator performance scores determine which becomes primary.

---

### Component 1: Router (VPS)

**Location:** VPS (`/home/ubuntu/coywolf/pack/router/`)
**Model:** Lightweight classifier (rule-based + small LLM call to Gemma 4 E4B on Den)
**Job:** Classify every incoming message before Anthropic is touched.

**Routing rules:**

| Task type | Route |
|---|---|
| Prowl execution, monitoring, bankroll check | → Local pack |
| Research deep dive (assigned topic) | → Local pack |
| Lucid feature build (from backlog) | → Local pack |
| Cron jobs, heartbeats, health checks | → Local pack |
| Morning brief, session snapshot | → Local pack |
| Novel architecture decision | → Coywolf (Anthropic) |
| Relationship/judgment calls | → Coywolf (Anthropic) |
| Explicit "ask Coywolf" | → Coywolf (Anthropic) |

**Brave Search kill:** Router also intercepts all `web_search` tool calls and reroutes to Den browser search. Zero API cost.

---

### Component 2: Arbor — Coordinator/Evaluator (Den)

**Model:** Gemma 4 E4B
**Location:** Den, runs as persistent service
**Neon tables:** `pack_tasks`, `pack_agent_profiles`, `pack_scores`

**Responsibilities:**
- Receive dispatched tasks from Router
- Select best available worker based on `pack_agent_profiles` score history
- Dispatch task to selected worker via `pack_tasks` queue
- Receive completed result, score it on 3 dimensions
- Update `pack_agent_profiles` with new score data
- Synthesize and return response through Clawdbot gateway

**Scoring dimensions (0-10 each):**
1. **Correctness** — Did output match objective? (Prowl: clean execution + valid backtest. Research: answers question with sources. Lucid: passes acceptance criteria.)
2. **Efficiency** — Token count and tool calls used. Lower is better.
3. **Handoff quality** — If multi-agent: did context transfer cleanly? Did downstream agent re-ask answered questions?

**Composite score** = (Correctness × 0.6) + (Efficiency × 0.2) + (Handoff × 0.2)

---

### Component 3: Worker Pool (Den)

**Agents:** Lumen, Vex, Mira, Coda, Sable
**Models:** Gemma 4 26B MoE + Qwen3.5-27B (Mira/Coda competing) + Qwen2.5-Coder-7B (Sable)
**Pool size:** 5 agents
**Neon table:** `pack_agent_profiles`

**Agent profile schema:**
```json
{
  "agent_id": "mira",
  "model": "gemma-4-26b-a4b-it",
  "task_history": [...],
  "scores_by_domain": {
    "prowl": 8.2,
    "research": 7.1,
    "lucid": 6.8
  },
  "total_tasks": 47,
  "avg_composite_score": 7.6,
  "last_active": "2026-04-03T19:00:00Z"
}
```

**Specialization:** Emerges from dispatch patterns. If wolf-003 consistently scores 8+ on Prowl, coordinator dispatches Prowl tasks to it. No hardcoded roles.

**Agent seeding objectives:**
- **Lumen** — Execute and monitor Prowl strategies (24/7 uptime)
- **Vex** — Develop and backtest new Prowl strategies
- **Mira** — Deep research on assigned topics
- **Coda** — Synthesize research into reports
- **Sable** — Lucid feature implementation from backlog

---

### Component 4: Knowledge & Tools

#### How agents access operational context

Agents on the Den are not persistent — they don't carry memory between tasks. Every task dispatch by Arbor includes a dynamically assembled system prompt with exactly the context needed. No stale state, no split brain.

**System prompt = 4 layers (assembled by Arbor at dispatch time):**

1. **Identity + objective** — agent name, seeded objective, scoring criteria it will be evaluated on
2. **Relevant memory snapshot** — Arbor fetches specific `.md` files from the VPS over SSH and injects them directly into the prompt. Files pulled per domain:
   - Lumen/Vex: `memory/entities/prowl-strategies.md`, active positions, bankroll state
   - Mira/Coda: research brief, prior reports, relevant reference docs
   - Sable: Lucid backlog item, `repos/lucid/` relevant files, acceptance criteria
3. **Tool manifest** — structured function signatures the agent can emit as JSON tool calls
4. **Domain rules** — explicit "when in doubt, check X" pointers per agent

#### Tool execution: VPS bridge model

Agents do not call tools directly. They emit structured tool-call JSON in their response. Arbor intercepts, executes the tool on the VPS (where all tools already work — `gh`, browser, exec, Neon, etc.), and returns the result to the agent as a follow-up message.

```
Agent emits:  {"tool": "exec", "command": "gh issue list --repo coywolffuturist/lucid"}
Arbor:        executes on VPS → returns stdout to agent
Agent:        continues reasoning with the result
```

**Tools available to agents via bridge:**
- `exec` — shell commands on VPS (git, gh, node scripts)
- `gh` — GitHub: issues, PRs, repos, file contents
- `browser` — Den browser search (replaces Brave Search API)
- `neon` — Postgres queries against pack_* and project tables
- `read_memory` — fetch any `.md` file from `/home/ubuntu/coywolf/memory/`
- `nodes_run` — run commands on Den (for Prowl execution, model ops)

**Why bridge over direct tool access:**
- All tools already work on VPS — zero duplication
- Arbor sees every tool call — full auditability, contributes to efficiency scoring
- No credentials needed on Den — VPS holds all auth
- Single execution layer = easier debugging

#### Per-agent knowledge sources

| Agent | Memory files injected | Key tools |
|---|---|---|
| Lumen | `prowl-strategies.md`, active positions, bankroll | `nodes_run` (strategy execution), `neon` (position tracking) |
| Vex | `prowl-strategies.md`, backtest history, market data | `browser` (market research), `exec` (backtest scripts) |
| Mira | Research brief, `reference/` relevant docs | `browser` (web research), `read_memory` |
| Coda | Mira's output, prior reports, report templates | `read_memory`, `exec` (write report to file) |
| Sable | Lucid issue/backlog item, relevant source files | `gh` (read/write issues, PRs), `exec` (run tests) |

---

### Component 5: Local Search (Den Browser)

**Replaces:** Brave Search API (kills $85/mo immediately)
**Implementation:** Den browser (Chrome) controlled via existing `browser` tool + `nodes.run`
**Integration point:** Router intercepts `web_search` calls, reroutes to Den browser search endpoint

---

### Component 5: Communication Layer

```
WhatsApp → VPS (Clawdbot gateway)
  → Router: classify task
    → Local pack (70-80%):
        → Coordinator (E4B) → selects worker → executes → scores → synthesizes
        → Response back through Clawdbot gateway → WhatsApp
    → Coywolf/Anthropic (20-30%):
        → Normal flow, unchanged
```

You communicate only with the coordinator's synthesized output. Individual agents are invisible unless you ask to inspect them.

---

## Neon Schema

```sql
-- Task queue
CREATE TABLE pack_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'pending', -- pending | assigned | complete | failed
  domain TEXT, -- prowl | research | lucid | general
  input JSONB,
  assigned_to TEXT, -- agent_id
  output JSONB,
  score JSONB -- {correctness, efficiency, handoff, composite}
);

-- Agent performance profiles
CREATE TABLE pack_agent_profiles (
  agent_id TEXT PRIMARY KEY,
  model TEXT,
  scores_by_domain JSONB DEFAULT '{}',
  total_tasks INTEGER DEFAULT 0,
  avg_composite_score FLOAT DEFAULT 0,
  last_active TIMESTAMPTZ
);

-- Score history (for trend analysis)
CREATE TABLE pack_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES pack_tasks(id),
  agent_id TEXT,
  domain TEXT,
  correctness FLOAT,
  efficiency FLOAT,
  handoff FLOAT,
  composite FLOAT,
  scored_at TIMESTAMPTZ DEFAULT now()
);
```

---

## File Structure

```
/home/ubuntu/coywolf/pack/
  router/
    index.ts          -- VPS router: classify + dispatch
    classifier.ts     -- Task classification logic
    search-proxy.ts   -- Brave Search kill + Den browser reroute
  coordinator/
    index.ts          -- Coordinator service (runs on Den)
    dispatcher.ts     -- Worker selection based on profile scores
    evaluator.ts      -- Scoring logic
    synthesizer.ts    -- Result synthesis + response formatting
  workers/
    agent.ts          -- Worker agent base class
    prowl-seed.yaml   -- Prowl objective seed
    research-seed.yaml -- Research objective seed
    lucid-seed.yaml   -- Lucid objective seed
  db/
    schema.sql        -- Neon pack_* tables
    migrations/       -- Future schema changes
  scripts/
    download-models.sh -- Model download helper
    start-pack.sh      -- Launch coordinator + workers
    status.sh          -- Pack health check
```

---

## Build Order

**Day 1:** Kill Brave Search API. Wire router to Den browser search. Immediate $85/mo savings.

**Day 2-3:** Build Router on VPS. Classification logic. Basic routing rules. No local pack yet — just starts routing decisions.

**Day 3-4:** Neon schema. Build Coordinator + Evaluator. Start with manual task dispatch (no queue yet).

**Day 4-5:** Wire task queue. Seed 3 worker agents with pillar objectives. Full loop: Router → Coordinator → Worker → Score → Response.

**Day 5-6:** First live run. Prowl monitor overnight. Observe coordinator scoring.

**Week 2:** Tune scoring weights. Observe domain specialization emerging. Add workers if throughput demands it.

---

## Success Metrics

| Metric | Baseline | Target (Week 2) |
|---|---|---|
| Anthropic daily spend | ~$10/day | <$2/day |
| Brave Search cost | $85/mo | $0 |
| Tasks handled locally | 0% | ≥70% |
| Prowl uptime | Dependent on Anthropic | 24/7 autonomous |
| Pack composite score | N/A | ≥7.5 avg |

---

## Decisions Locked

1. **Brave Search cancellation** — After local search is verified working.
2. **Worker count** — 5 agents: Lumen, Vex, Mira, Coda, Sable.
3. **Escalation threshold** — Auto-escalate to Coywolf if pack composite score < 6.0.
4. **Agent names** — Arbor (coordinator), Lumen, Vex, Mira, Coda, Sable (workers).

---

*Spec written: 2026-04-03 | Status: Awaiting Brendan approval*
