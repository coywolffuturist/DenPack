# Sable — Eval Stack & Build Plan
*DenPack Pack Agent Spec · Version 1.0 · 2026-04-04*

**Role:** Lucid Builder — implements features and fixes in the Lucid codebase.

### Sable (Lucid Builder)

**Role:** Implements features from the Lucid backlog. Produces code that passes tests and ships to staging.

#### Eval Stack — Current State

| Layer | What's Tested Today | Signal Quality |
|-------|---------------------|----------------|
| Unit | None | 0/10 |
| Signal | None | 0/10 |
| Outcome | None | 0/10 |

**Note:** Model is being upgraded from `qwen3-coder-30b-a3b` to a new model. Eval stack should be model-agnostic — test the output, not the model.

#### Eval Stack — Target

**Layer 1 — Unit (Code Validity)**
 Test: Does Sable's code pass a TypeScript compile check without errors?
  - Formula: `compile_pass_rate = passing_builds / total_submissions`
  - Threshold: ≥ 95%
 Test: Does Sable's code pass existing test suite without regressions?
  - Formula: `regression_rate = new_failures / prior_passing_tests`
  - Threshold: regression_rate = 0 (zero regressions)
 File: `tests/sable/unit-compile.test.ts`

**Layer 2 — Signal (Feature Completeness)**
Score each Sable feature implementation on:

| Criterion | Weight | Signal |
|-----------|--------|--------|
| Acceptance criteria coverage | 0.40 | % of AC items in the ticket that are satisfied by the implementation. Formula: `satisfied_ac / total_ac`. Threshold sub-score: ≥ 0.80 |
| Test coverage | 0.25 | Line coverage % on new code. Target: ≥ 80%. Score: `min(coverage/80, 1.0)` |
| Code style | 0.15 | ESLint pass: binary 1 or 0 |
| PR size discipline | 0.20 | PR diff ≤ 400 lines. Score: `1.0` if ≤ 400, `400/diff_lines` if > 400 |

 Formula: `feature_quality = sum(criterion_score × weight)`
 Threshold: ≥ 0.70

**Layer 3 — Outcome (Staging Survival)**
 Does the feature pass QA on staging without requiring a hotfix within 48 hours?
  - Formula: `staging_survival_rate = features_passing_QA / total_features_shipped`
  - Threshold: ≥ 0.80 (at most 1 in 5 features needs a hotfix)

#### Build Plan

**New file: `workers/sable/context.md`**
 Lucid backlog format (how tickets are structured)
 Acceptance criteria extraction rules
 PR size limit (400 lines)
 Test coverage target (80%)

**New file: `workers/sable/ticket-parser.ts`**
 Parses Lucid ticket JSON into structured `{ title, description, acceptance_criteria[], priority }` object
 Feeds Sable's prompt

**New file: `workers/sable/pr-validator.ts`**
 Runs compile check, test suite, ESLint
 Computes line diff size
 Reports pass/fail per criterion

**Modify: `workers/tool-runtime.ts`**
 Ensure `gh` tool can open PRs and read existing PR diffs
 Add `run_tests` tool: runs `npm test` in a specified repo directory, returns JSON result

**Modify: `db/schema.sql`**
```sql
CREATE TABLE pack_sable_features (
  id SERIAL PRIMARY KEY,
  ticket_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  pr_url TEXT,
  compile_pass BOOLEAN,
  regression_count INTEGER,
  ac_coverage FLOAT,
  test_coverage FLOAT,
  lint_pass BOOLEAN,
  diff_lines INTEGER,
  feature_quality_score FLOAT,
  staging_survival BOOLEAN,
  staging_hotfix_required BOOLEAN
);
```

**Success criteria:**
 Compile pass rate ≥ 95%
 Zero regressions on any PR
 `feature_quality` ≥ 0.70 on first 10 tickets
 Staging survival rate ≥ 0.80 over first 20 shipped features

**Dependencies:** Lucid ticket access (Sable needs API or file-based ticket feed). Staging environment must exist for Layer 3. Model upgrade must be complete before eval baseline is set.

--

## Shared Infrastructure

All agents depend on infrastructure that does not yet exist in DenPack. These must be built before individual agent evals can run reliably.

