# Local Pack System — Design Spec
*Version 1.1 — 2026-04-03*

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

#### Tool execution: Co-located model (tools + memory on Den)

Agents have direct access to both tools and memory on the Den. No round trips to the VPS for every tool call. This keeps the agent's chain of thought tight — it can reason about memory and tools jointly without latency breaking the loop.

```
Agent:   reads memory/prowl-strategies.md directly
Agent:   recalls backtest #7 failed with this approach
Agent:   skips that tool call, tries different approach
Agent:   executes gh to read Lucid issue
Agent:   returns result — no Arbor intermediary
```

**Tools installed locally on Den per agent:**
- `gh` — GitHub CLI (authenticated on Den)
- `browser` — Den browser search via local Chrome CDP
- `neon` — Postgres client with direct connection string
- `read_memory` — local read of synced memory snapshot
- `exec` — shell execution on Den (strategy scripts, tests)

**Memory sync:**
At task dispatch, Arbor pushes a fresh memory snapshot to the agent's working directory (SSH rsync from VPS, ~1-2 seconds). Agent reads locally for the duration of the task. No stale state — snapshot is always task-specific and fresh.

**Arbor's role:**
Arbor still dispatches, scores, and synthesizes. But it scores based on outputs and token logs — not by intercepting every tool call. Agents are trusted to execute autonomously. Auditability comes from structured output logging, not from being a proxy.

**Why co-location over VPS bridge:**
- Tight reasoning loop — agent doesn't break CoT waiting for tool results
- Agents that remember + act together outperform agents that request both externally
- Latency: local tool calls are ~10ms vs ~200-500ms round trip
- Scales better — 5 agents making concurrent tool calls don't bottleneck through one VPS proxy

**Credentials on Den:**
- `gh` auth token stored in Den keychain (already partially set up via LM Studio login)
- Neon connection string in Den `.env` (never in repo)
- SSH key for VPS memory sync already exists

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

**Day 3-4:** Neon schema. Build Arbor (Coordinator + Evaluator). Memory sync mechanism (VPS → Den rsync at task dispatch).

**Day 4-5:** Install tool suite on Den: `gh` auth, Neon client, browser CDP wiring, exec wrappers. Verify each tool works locally on Den.

**Day 5-6:** Wire task queue. Seed all 5 workers with co-located tools + memory. Full loop: Router → Arbor → Worker (local tools + memory) → Score → Response.

**Day 6-7:** First live run. Prowl monitor overnight with Lumen. Observe Arbor scoring.

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

## V2 Enhancements

### Council Mode (Karpathy LLM Council pattern)

**What:** Instead of Arbor dispatching to one worker, dispatch the same question to multiple workers simultaneously. Each worker reviews the others' responses with authorship anonymized (so no worker defers to another by name). Arbor acts as Chairman — synthesizes the final answer from all responses and reviews.

**Why local compute makes this viable:** Council mode costs ~5x more inference per query. On Anthropic that's prohibitive. On Den with local models — effectively free. This is the scenario where local compute unlocks a pattern that's impractical at cloud prices.

**Three-stage flow:**
1. **First opinions** — same query dispatched to 3-5 workers independently, responses collected
2. **Anonymous review** — each worker receives other workers' responses with names stripped; ranks them on accuracy and insight
3. **Chairman synthesis** — Arbor reads all responses + rankings, produces final answer

**Where council mode adds most value:**
- **Vex strategy development** — 3 strategy variants, council picks the most robust
- **Mira research synthesis** — multiple research passes, council surfaces best-supported claims
- **Escalation decisions** — instead of heuristic score threshold, council votes on whether to escalate to Coywolf
- **Architecture decisions** — any question where sycophancy is dangerous

**Implementation note:** Anonymization is the critical detail. Without it, models defer to perceived authority. With it, they judge on merit. Each worker receives a prompt like: "Here are three responses labeled A, B, C. Rank them by accuracy and insight. Do not consider who wrote them."

**Neon additions needed:**
- `pack_council_sessions` — group multiple task runs under one council session
- `pack_council_votes` — individual worker rankings per council session

---

### Semantic Memory Retrieval

**What:** Replace blunt full-file memory push with task-aware section retrieval. Arbor reads the task domain + text, selects only the relevant sections from a lightweight memory index, and builds a tight composite context file for the agent. No external dependencies — just a manifest + line-slicing.

**Why it matters for Council Mode:** V1 Council costs 5 agents × full memory files per round. Semantic retrieval cuts that 50-70%, making multi-agent councils practical at scale on local models.

**Full spec:** [`specs/semantic-memory-retrieval.md`](./semantic-memory-retrieval.md)

---

### Evolutionary Pressure (performance-triggered, not calendar-based)

**What:** Each agent continuously faces survival pressure. When an agent underperforms or stagnates, Arbor clones it into two variants, seeds each with a deliberately different strategy (via Coywolf/Anthropic), runs them in competition, and promotes the winner as the new canonical agent for that slot.

**Why performance-triggered, not weekly:**
Different roles accumulate tasks at wildly different rates. Lumen runs Prowl 24/7 — it might log 20 tasks in a day. Sable builds Lucid features — maybe 3-5 tasks a week. A fixed weekly cadence punishes fast agents (too slow to improve) and destabilizes slow ones (too few data points to judge fairly). Threshold-based triggering lets each agent evolve at the natural pace of its domain.

**Two evolution triggers:**

1. **Underperformance** — rolling composite score < 6.5 over last 20 tasks. Agent is demonstrably stuck. Trigger immediately.
2. **Stagnation** — composite score hasn't improved by > 0.5 points over last 30 tasks, regardless of absolute level. Even a good agent that stops improving gets forked.

**Minimum task floor:** 10 completed tasks before either trigger can fire. New clones get a grace period — no premature culling.

**The evolution cycle:**

1. Trigger fires on agent X
2. Arbor escalates to Coywolf with a structured brief:
   - Agent name + domain
   - Last N task history + scores
   - Strategies attempted
   - What top performers in the pack did differently
3. Coywolf seeds two genuinely divergent strategies — not variations on the same theme, but distinct hypotheses about what could work better
4. Two clones (X-A, X-B) are instantiated with those seeded strategies in their system prompts
5. Original agent X continues running alongside both clones (pack temporarily has 6)
6. After minimum 10 tasks each: best composite score of X-A vs X-B becomes the new canonical agent for that slot
7. Original X and the losing clone are retired. Pack returns to 5.

**Why Coywolf seeds the divergence (not Arbor):**
Arbor (E4B) is a coordinator — fast, always-on, but limited reasoning capacity. Generating genuinely novel divergent strategies requires frontier-model judgment. Coywolf reads the full performance brief and produces two hypotheses the pack then tests empirically. Over time this creates a feedback loop: Coywolf learns which strategic hypotheses pan out across domains, compounding into better seeding in future cycles.

**What this prevents:**
- Path dependency — winner-takes-all convergence to a local optimum
- Strategic monoculture — the pack never fully commits to one approach per domain
- Stagnation — good-enough agents that stop improving get challenged anyway

**Neon additions needed:**
- `pack_agent_lineages` — track clone relationships (parent → child), retirement history
- `pack_evolution_events` — log each trigger, Coywolf brief, seeded strategies, tournament result

---

*Spec written: 2026-04-03 | Status: Approved, build in progress*
