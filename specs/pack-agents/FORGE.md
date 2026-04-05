# Forge — Spec
*DenPack Pack Agent · Version 1.0 · 2026-04-05*

**Role:** Code Reviewer — independent adversarial review of Sable's implementations.

---

## Why Forge Exists

Sable cannot review its own code. A model reviewing its own output shares the same error distribution — it reinforces its blind spots rather than correcting them. Over self-improvement iterations this produces model collapse: Sable gets better at writing code that *looks right to Sable*, not code that actually works.

Forge has a different base model (DeepSeek-Coder 16B), different training, different failure modes. Its job is to find what Sable can't see.

Forge is scored not on the quality of its prose but on whether its verdict **predicted the test outcome**. Ground truth is always the test runner.

---

## Model

**DeepSeek-Coder-V2 16B (MLX 4-bit)**

Different architecture from Sable (Qwen2.5-Coder 32B). This is non-negotiable — same model in critic mode is not an independent reviewer.

---

## Forge's Place in the Loop

```
Sable writes tests (TDD — tests committed BEFORE implementation)
Sable implements chunk
Forge reviews → verdict (APPROVE / REJECT) + score 1–10 + specific issues
Tests run → pass/fail (ground truth)
Arbor records (Forge verdict, test outcome) → updates Forge accuracy
```

Forge never sees Sable's tests before writing its review. It reviews the implementation cold.

---

## Seed Prompt

```
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

---

## Scoring Forge (How Arbor Evaluates Forge)

Arbor records every (Forge verdict, test outcome) pair:

| Forge says | Tests say | Label |
|------------|-----------|-------|
| APPROVE | Pass | True Positive ✅ |
| REJECT | Fail | True Negative ✅ |
| APPROVE | Fail | **False Negative 🔴** — Forge missed a real bug |
| REJECT | Pass | False Positive 🟡 — Forge was too harsh |

**Forge's accuracy score:**
```
precision = true_positives / (true_positives + false_positives)
recall    = true_positives / (true_positives + false_negatives)
f1        = 2 * (precision * recall) / (precision + recall)
```

Target: F1 ≥ 0.75. Below 0.60 triggers review by Coywolf.

**False negative rate by category** — Arbor tracks which *types* of bugs Forge misses:
- Off-by-one errors
- Null/undefined handling
- Type mismatches
- Scope creep (did too much)
- Missing error handling

When Forge's false negative rate in a category exceeds 30% over 20 reviews, Arbor surfaces it to Coywolf: "Forge is consistently missing [category]. Consider prompt update or model swap."

---

## Forge's Self-Improvement Signal

Forge improves by seeing its own false negatives. After every 20 reviews, Arbor feeds Forge a summary:

```
You approved 3 implementations that later failed tests. Here are the failures:
[chunk instruction] → [what you said] → [what actually broke]

What pattern did you miss? Propose one addition to your review checklist.
```

Forge's proposed checklist additions go to `workers/forge/review-checklist.md`. Coywolf approves or rejects each addition. This is the same model as Lumen context updates — Forge proposes, Coywolf reviews.

---

## What Forge Does NOT Do

- Does not run tests (that's the test runner's job)
- Does not suggest rewrites (flags issues, Sable decides how to fix)
- Does not review Sable's tests (reviewed separately, or not at all — tests are ground truth)
- Does not route tasks (that's Arbor)
- Does not score Sable on business outcomes (that's Arbor's outcome layer)

---

## Database Schema

```sql
CREATE TABLE pack_forge_reviews (
  id SERIAL PRIMARY KEY,
  reviewed_at TIMESTAMPTZ DEFAULT NOW(),
  chunk_id TEXT NOT NULL,
  sable_run_id TEXT,
  verdict TEXT CHECK (verdict IN ('APPROVE', 'REJECT')),
  score INTEGER CHECK (score BETWEEN 1 AND 10),
  issues JSONB,           -- [{severity, description}]
  reasoning TEXT,
  test_outcome TEXT,      -- 'pass' | 'fail' | 'pending'
  label TEXT,             -- 'true_positive' | 'true_negative' | 'false_negative' | 'false_positive'
  f1_rolling FLOAT        -- updated by Arbor after each outcome
);

CREATE TABLE pack_forge_checklist_proposals (
  id SERIAL PRIMARY KEY,
  proposed_at TIMESTAMPTZ DEFAULT NOW(),
  trigger_false_negatives JSONB,  -- the failures that prompted this
  proposal TEXT,
  approved BOOLEAN,
  approved_by TEXT DEFAULT 'coywolf',
  applied_at TIMESTAMPTZ
);
```

---

## Build Plan

**New file: `workers/forge/seed.md`** — system prompt above

**New file: `workers/forge/review-checklist.md`** — starts empty, grows via self-improvement loop

**New file: `workers/forge/agent.ts`** — mirrors sable/agent.ts structure, calls DeepSeek-Coder 16B endpoint

**Modify: `coordinator/evaluator.ts`** — add Forge invocation after every Sable chunk completion

**Modify: `coordinator/dispatcher.ts`** — add `forge` to agent registry; Forge is never dispatched directly by tasks, only invoked by Arbor post-Sable

**Modify: `db/schema.sql`** — add tables above

**Modify: `README.md`** — add Forge to pack roster

---

## Success Criteria

- F1 ≥ 0.75 on first 50 reviews
- Zero reviews where Forge approves code that breaks compilation
- False negative rate < 30% in any single category over 20 reviews
- Checklist grows by at least 3 validated items in first 30 days
