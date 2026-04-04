# Arbor — Eval Stack & Build Plan
*DenPack Pack Agent Spec · Version 1.0 · 2026-04-04*

**Role:** Coordinator/Evaluator — routes tasks to the right agent, scores outputs, evolves the harness.

### Arbor (Coordinator/Evaluator)

**Role:** Routes tasks to the right agent, scores outputs, evolves the harness.

#### Eval Stack — Current State

| Layer | What's Tested Today | Signal Quality |
|-------|---------------------|----------------|
| Unit | Dispatcher selects correct agent by domain keyword | 3/10 |
| Signal | Evaluator scores output by keyword presence in response text | 1/10 |
| Paper | None | 0/10 |
| Outcome | None | 0/10 |

**Critical gap:** `coordinator/evaluator.ts` scores responses by checking for the presence of words like "analyzed", "found", "result". A response that says "I found nothing" scores as well as one that says "I found a 12% edge." This is cosplay evaluation.

**Secondary gap:** `coordinator/dispatcher.ts` selects agents by matching task text to domain keywords in `pack_agent_profiles`. This means a task about "NBA trading research" could route to either Lumen or Mira depending on which word appears first. There is no learned routing.

#### Eval Stack — Target

**Layer 1 — Unit (Dispatcher Accuracy)**
 Test: Present 50 canonical task descriptions (10 per agent domain). Score: % routed to correct agent.
 Formula: `dispatcher_accuracy = correct_routes / total_tasks`
 Threshold: ≥ 90% to pass. Failure triggers dispatcher audit.
 File: `tests/arbor/dispatcher-accuracy.test.ts`

**Layer 2 — Signal (Evaluation Calibration)**
 Test: Feed Arbor 20 graded response pairs (A = clearly better, B = clearly worse, ground truth set by Coywolf). Score: % of pairs where Arbor correctly identifies the better response.
 Formula: `calibration_score = correct_preferences / total_pairs`
 Threshold: ≥ 75% to pass (chance = 50%).
 File: `tests/arbor/eval-calibration.test.ts`
 Ground truth pairs stored in: `tests/arbor/fixtures/graded-pairs.json`

**Layer 3 — Harness Evolution (V2)**
 After every 20 task cycles, Arbor proposes one harness mutation (prompt change, routing rule change, or eval rubric change).
 Score: `harness_delta = avg_outcome_score_after_mutation - avg_outcome_score_before_mutation` over next 10 tasks
 Log all mutations + deltas to: `db/schema.sql → pack_harness_mutations` (new table)
 Threshold: Average delta ≥ 0 over 5 mutation cycles (mutations don't make things worse on average).

#### Build Plan

**File: `coordinator/evaluator.ts` — REPLACE keyword scoring**
 Remove: all `response.includes('keyword')` logic
 Add: structured rubric scoring using a JSON rubric loaded per agent domain
 Rubric format: `{ criteria: [{name, weight, signal_fn}] }` where `signal_fn` extracts a numeric signal from the response
 Example for Lumen: `{ name: "position_sizing_rationale", weight: 0.3, signal_fn: "extract_kelly_fraction_mentioned" }`
 New file: `coordinator/rubrics/lumen.json`, `coordinator/rubrics/mira.json`, etc.

**File: `coordinator/dispatcher.ts` — ADD routing confidence**
 Add a `confidence` field to each routing decision (0–1 float)
 When confidence < 0.6, log to `pack_scores` with `flag = 'low_confidence'` for Coywolf review
 This creates a dataset for improving routing over time

**File: `db/schema.sql` — ADD tables**
```sql
CREATE TABLE pack_harness_mutations (
  id SERIAL PRIMARY KEY,
  proposed_at TIMESTAMPTZ DEFAULT NOW(),
  mutation_type TEXT, -- 'prompt' | 'routing' | 'rubric'
  description TEXT,
  before_score FLOAT,
  after_score FLOAT,
  delta FLOAT,
  accepted BOOLEAN
);
```

**Success criteria:**
 Dispatcher accuracy ≥ 90% on 50-task fixture suite
 Calibration score ≥ 75% on graded-pairs fixture
 Zero keyword-based scoring logic remaining in `coordinator/evaluator.ts`

**Dependencies:** Graded-pairs fixture must be created by Coywolf (human ground truth). All other build tasks are Arbor-internal.

--

