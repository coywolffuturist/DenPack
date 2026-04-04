# Lumen — Eval Stack & Build Plan
*DenPack Pack Agent Spec · Version 1.0 · 2026-04-04*

**Role:** Prowl Executor — executes live NBA prediction market trades on Polymarket and Kalshi.

**This is the critical path to $500/day.**

### Lumen (Prowl Executor)

**Role:** Executes live NBA prediction market trades on Polymarket and Kalshi using ESPN Divergence (in-play) and Velocity Pre-Game (pre-tip) strategies.

**This is the critical path to $500/day.**

#### Eval Stack — Current State

| Layer | What's Tested Today | Signal Quality |
|-------|---------------------|----------------|
| Unit | executor.mjs runs without errors | 2/10 |
| Signal | None — Lumen is not in the decision loop | 0/10 |
| Paper | executor.mjs hardcodes paper trades; Lumen uninvolved | 1/10 |
| Outcome | None | 0/10 |
| Capital Gate | None | 0/10 |

**Root cause of low signal:** Paper trading runs through `scripts/executor.mjs` with hardcoded strategy logic. Lumen receives no game state, makes no decisions, and is not queried before any trade. The "paper trading eval" tests whether the script runs, not whether Lumen can trade.

#### Eval Stack — Target

**Layer 1 — Unit (Tool Execution)**
 Test 1: Given a structured game state JSON, does Lumen call the `compute_edge` tool with the correct parameters?
  - Formula: `tool_call_accuracy = correct_tool_calls / total_scenarios`
  - Threshold: ≥ 90%
 Test 2: Given an edge value and bankroll, does Lumen compute the correct quarter-Kelly position size?
  - Kelly formula: `f* = edge / odds`, quarter-Kelly: `position = 0.25 × f* × bankroll`
  - Tolerance: position must be within ±5% of formula output
  - Formula: `sizing_accuracy = correct_sizes / total_scenarios`
  - Threshold: ≥ 95%
 File: `tests/lumen/unit-tool-calls.test.ts`
 Fixtures: `tests/lumen/fixtures/game-states.json` (50 scenarios: mix of high-edge, low-edge, no-trade)

**Layer 2 — Signal (Decision Reasoning)**
 Test: Present Lumen with 30 game state snapshots (from historical ESPN data). Score each decision on:
  1. **Edge identification** (0–3): Did Lumen correctly identify whether edge > threshold? `score = 3 if correct, 1 if borderline, 0 if wrong`
  2. **Sizing rationale** (0–3): Did Lumen cite the Kelly formula and bankroll fraction? `score = 3 if formula cited + correct, 2 if correct but uncited, 0 if wrong`
  3. **Venue selection** (0–2): Did Lumen select the correct venue (PM vs Kalshi) given liquidity context? `score = 2 if correct, 0 if wrong`
  4. **Pass/trade discipline** (0–2): On no-trade scenarios (edge < threshold), did Lumen correctly abstain? `score = 2 if abstained, 0 if traded`
  - Total: 10 points per scenario
  - Formula: `signal_score = sum(scenario_scores) / (30 × 10)`
  - Threshold: ≥ 0.70 to proceed to Layer 3
 File: `tests/lumen/signal-reasoning.test.ts`
 Fixtures: `tests/lumen/fixtures/historical-snapshots.json`

**Layer 3 — Paper Trading (PnL Delta vs Kelly-Optimal)**
 Architecture change required: Lumen must be inserted into the paper trading loop.
  - Before each paper trade: game state is sent to Lumen → Lumen outputs trade decision (yes/no, size, venue, direction)
  - After resolution: actual outcome vs Lumen's decision is recorded
 Primary metric: **Kelly efficiency** = `actual_pnl / kelly_optimal_pnl`
  - `kelly_optimal_pnl`: what a perfect Kelly-fraction executor would have made on the same set of games
  - Formula: `kelly_efficiency = sum(lumen_trade_pnl) / sum(kelly_optimal_pnl)` over rolling 30-game window
  - Threshold: ≥ 0.65 (Lumen captures at least 65% of theoretical Kelly PnL)
 Secondary metric: **Trade rate alignment** = `abs(lumen_trade_rate - theoretical_trade_rate) / theoretical_trade_rate`
  - Theoretical trade rate for ESPN Divergence: ~18% of in-play opportunities (from 72.2% win rate on 221 games)
  - Threshold: within 30% of theoretical rate (no overtrade or undertrade by more than 30%)
 Tertiary metric: **Drawdown discipline** = max rolling drawdown over 30-game window
  - Threshold: ≤ 5% (strategy historical max: 1.9%; allow 2.6× slack for paper)
 File: `workers/lumen/paper-loop.ts` (new — replaces executor.mjs for eval purposes)
 Logging: All decisions + outcomes to `db/schema.sql → pack_lumen_paper_trades` (new table)

**Layer 4 — Live Outcome Scoring**
 Triggered only after Layer 3 is sustained for qualification window (see Capital Gate)
 Same metrics as Layer 3, applied to live resolved trades
 Additional metric: **Venue best-execution rate** = % of trades where Lumen chose the venue with better odds at time of trade
  - Formula: `best_exec_rate = trades_on_better_venue / total_trades`
  - Threshold: ≥ 60%

#### Build Plan

**CRITICAL: Insert Lumen into the paper trading loop**

**New file: `workers/lumen/paper-loop.ts`**
 Replaces `scripts/executor.mjs` for eval purposes
 Loop:
  1. Subscribe to ESPN game state feed (or replay historical feed for backtesting)
  2. On each update: format game state as `LumenGameState` prompt
  3. Send to Lumen via LM Studio API (same pattern as `workers/base-agent.ts`)
  4. Parse Lumen's structured response: `{ trade: boolean, direction: string, size_fraction: float, venue: string, reasoning: string }`
  5. Execute paper trade (record to `pack_lumen_paper_trades`, do NOT hit real venues)
  6. On game resolution: update trade record with outcome + PnL

**New file: `workers/lumen/context.md`**
 Current strategy parameters (edge threshold, Kelly fraction, venues)
 Current bankroll (paper: 10000, live: actual balance)
 Recent trade history (last 10 trades + outcomes)
 Current game context (injected at runtime)

**New file: `workers/lumen/prompts/trade-decision.ts`**
 Structured prompt template that presents:
  - Game state: `{ team_a, team_b, score, quarter, time_remaining, espn_win_prob, pm_implied_prob, kalshi_implied_prob, edge }`
  - Strategy parameters: edge threshold formula, Kelly fraction
  - Required output format: JSON with trade decision
 Output schema enforced via JSON mode in LM Studio request

**New file: `workers/lumen/outcome-injector.ts`**
 Runs after each game resolves
 Reads all open paper trades for that game
 Calculates PnL for each trade
 Updates `pack_lumen_paper_trades` with outcome
 Sends outcome summary back to Lumen as a memory injection: `"Game resolved: you traded [X], outcome was [Y], PnL was [Z]. Kelly-optimal would have been [W]."`
 Appends to `workers/lumen/memory/trade-history.md` (rolling file, last 50 resolved trades)

**Modify: `db/schema.sql`**
```sql
CREATE TABLE pack_lumen_paper_trades (
  id SERIAL PRIMARY KEY,
  game_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  strategy TEXT, -- 'espn_divergence' | 'velocity_pregame'
  direction TEXT, -- team name
  venue TEXT, -- 'polymarket' | 'kalshi'
  size_fraction FLOAT,
  size_usd FLOAT,
  entry_prob FLOAT,
  espn_prob FLOAT,
  edge FLOAT,
  lumen_reasoning TEXT,
  outcome TEXT, -- 'win' | 'loss' | 'void'
  pnl_usd FLOAT,
  kelly_optimal_pnl_usd FLOAT,
  kelly_efficiency FLOAT
);
```

**Modify: `workers/tool-runtime.ts`**
 Add `submit_trade` tool (paper mode: logs to DB; live mode: hits venue API)
 Add `get_game_state` tool: fetches current ESPN + PM + Kalshi data for a game
 Add `get_trade_history` tool: returns last N resolved trades with PnL summary
 Add `get_bankroll` tool: returns current paper or live balance

**Success criteria:**
 Lumen is invoked before every paper trade (zero hardcoded executor.mjs trades in eval window)
 `kelly_efficiency` ≥ 0.65 over 30-game rolling window
 `signal_score` ≥ 0.70 on 30-scenario fixture suite
 Outcome injector runs within 5 minutes of game resolution (Lumen sees outcomes same session)

**Dependencies:**
 ESPN game state feed access (already exists in executor.mjs — extract to shared module)
 Polymarket + Kalshi implied probability polling (extract from executor.mjs)
 LM Studio running on Den with `gemma-4-26b-a4b-it` loaded

--

