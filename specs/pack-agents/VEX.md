# Vex — Eval Stack & Build Plan
*DenPack Pack Agent Spec · Version 1.0 · 2026-04-04*

**Role:** Prowl Strategist — develops, tests, and improves prediction market strategies.

### Vex (Prowl Strategist)

**Role:** Develops new trading strategies, backtests them on historical data, and hands off validated strategies to Lumen.

#### Eval Stack — Current State

| Layer | What's Tested Today | Signal Quality |
|-------|---------------------|----------------|
| Unit | None | 0/10 |
| Signal | None | 0/10 |
| Paper | None | 0/10 |
| Outcome | None | 0/10 |

**Gap:** Vex has no eval infrastructure at all. Strategy quality is currently judged by Coywolf reading Vex's output manually.

#### Eval Stack — Target

**Layer 1 — Unit (Backtest Execution)**
 Test: Given a strategy spec and historical game dataset, does Vex produce a valid backtest result?
  - Valid = `{ strategy_name, n_trades, win_rate, avg_pnl, max_drawdown, sharpe }` with no null fields
  - Formula: `backtest_validity_rate = valid_backtests / total_requests`
  - Threshold: ≥ 95%
 File: `tests/vex/unit-backtest.test.ts`

**Layer 2 — Signal (Strategy Quality)**
 Score each proposed strategy on a 4-criterion rubric:
  1. **Edge source clarity** (0–3): Is the edge source identified and mechanistically explained?
     - `3` = specific mechanism cited (e.g., "PM lags ESPN by 8+ min because market makers are slow to update")
     - `1` = vague ("there's a pricing lag")
     - `0` = no edge source
  2. **Backtest validity** (0–3): Is the backtest methodology sound?
     - `3` = correct train/test split, no look-ahead bias, n ≥ 30
     - `2` = minor issues
     - `0` = look-ahead bias present or n < 15
  3. **Risk parameters** (0–2): Are Kelly fraction and drawdown limits specified?
     - `2` = both specified with formula
     - `0` = either missing
  4. **Handoff readiness** (0–2): Is the strategy spec detailed enough for Lumen to execute without Vex?
     - `2` = entry/exit rules fully specified in rule-parseable format
     - `0` = requires interpretation
  - Formula: `strategy_quality_score = sum(criteria) / 10`
  - Threshold: ≥ 0.70 for a strategy to be eligible for handoff to Lumen

**Layer 3 — Outcome (Strategy Survival Rate)**
 After a Vex strategy is handed to Lumen and run for ≥ 20 paper trades:
  - Record the strategy's actual win rate, PnL, and max drawdown
  - Compare to Vex's backtest prediction
  - Formula: `prediction_accuracy = 1 - abs(predicted_win_rate - actual_win_rate)`
  - Threshold: prediction accuracy ≥ 0.80 (actual within 20pp of predicted)
 File: `tests/vex/strategy-survival.test.ts`
 Data from: `pack_lumen_paper_trades` joined with `pack_vex_strategies` (new table)

#### Build Plan

**New file: `workers/vex/context.md`**
 Current active strategies (ESPN Divergence, Velocity Pre-Game) as baseline reference
 Historical game dataset pointer (for backtesting)
 Strategy handoff format spec

**New file: `workers/vex/backtest-runner.ts`**
 Accepts strategy spec JSON from Vex
 Replays historical game data against strategy rules
 Returns standardized backtest result object
 File: `workers/vex/backtest-runner.ts`

**Modify: `db/schema.sql`**
```sql
CREATE TABLE pack_vex_strategies (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  strategy_name TEXT UNIQUE,
  edge_source TEXT,
  entry_rules JSONB,
  kelly_fraction FLOAT,
  backtest_n INTEGER,
  backtest_win_rate FLOAT,
  backtest_pnl_per_trade FLOAT,
  backtest_max_drawdown FLOAT,
  status TEXT, -- 'proposed' | 'paper_testing' | 'live' | 'retired'
  quality_score FLOAT
);
```

**Success criteria:**
 Backtest validity rate ≥ 95%
 At least 1 new strategy per month passes quality threshold ≥ 0.70 and enters paper testing
 Prediction accuracy ≥ 0.80 on first strategy handed to Lumen

**Dependencies:** Historical NBA game dataset with ESPN win probabilities + Polymarket prices (backfill from executor.mjs logs). Lumen paper loop must be running to test strategy survival.

--

