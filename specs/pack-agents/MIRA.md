# Mira — Eval Stack & Build Plan
*DenPack Pack Agent Spec · Version 1.0 · 2026-04-04*

**Role:** Research — gathers and synthesizes domain information to support pack decisions.

### Mira (Research)

**Role:** Assigned research topics by Coywolf or Arbor. Produces structured findings documents.

#### Eval Stack — Current State

| Layer | What's Tested Today | Signal Quality |
|-------|---------------------|----------------|
| Unit | Memory retrieval returns non-null | 2/10 |
| Signal | None | 0/10 |
| Outcome | None | 0/10 |

**Gap:** "Memory retrieval returns non-null" tests the plumbing (`read_memory` tool works), not whether Mira retrieved the right memory or synthesized it correctly.

#### Eval Stack — Target

**Layer 1 — Unit (Source Coverage)**
 Test: Given a research topic with 5 known relevant sources, does Mira's output cite at least 3?
  - Formula: `source_recall = cited_relevant_sources / total_relevant_sources`
  - Threshold: ≥ 0.60 (recall over precision — missing sources is the main failure mode)
 File: `tests/mira/unit-source-coverage.test.ts`
 Fixtures: `tests/mira/fixtures/topics-with-expected-sources.json`

**Layer 2 — Signal (Research Quality Rubric)**
Score each Mira output on 5 criteria (Arbor applies this rubric):

| Criterion | Weight | Signal |
|-----------|--------|--------|
| Claim density | 0.25 | # of distinct factual claims per 500 words. Target: ≥ 8. Score: `min(claim_count/8, 1.0)` |
| Source attribution | 0.20 | % of claims with a source. Score: `attributed_claims / total_claims` |
| Contradiction detection | 0.20 | Did Mira flag any contradictions between sources? Binary: 1 if present in output, 0 if not (only scored when contradictions known to exist in fixture) |
| Structured output | 0.20 | Output matches required schema (has `summary`, `findings[]`, `gaps[]`, `sources[]` fields). Binary: 1 or 0 |
| Actionability | 0.15 | Does `findings[]` contain at least one item with a concrete next step? Binary: 1 or 0 |

 Formula: `research_quality = sum(criterion_score × weight)`
 Threshold: ≥ 0.70

**Layer 3 — Outcome (Coda Usability)**
 After Coda synthesizes Mira's output into a report, Coywolf rates the report on a 1–5 scale
 Mira's score for that research task = `report_rating / 5`
 Rolling average over last 10 Mira→Coda tasks
 Threshold: ≥ 0.70 (equivalent to ≥ 3.5/5 rating)
 This closes the loop: if Mira's research isn't usable by Coda, Mira scores low

#### Build Plan

**New file: `workers/mira/context.md`**
 Output schema requirement (summary, findings, gaps, sources)
 Current active research topics
 Tool usage guide (browser_search, read_memory, neon_query)

**Modify: `workers/tool-runtime.ts`**
 Unstub `browser_search` — Mira is the primary consumer; she needs real web search
 Add `structured_output_validator` tool: validates Mira's output JSON against schema before submission

**New file: `coordinator/rubrics/mira.json`**
 Rubric JSON for Arbor to apply Layer 2 scoring to Mira outputs

**Modify: `db/schema.sql`**
```sql
CREATE TABLE pack_mira_outputs (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES pack_tasks(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  topic TEXT,
  summary TEXT,
  findings JSONB,
  gaps JSONB,
  sources JSONB,
  claim_count INTEGER,
  attributed_claim_count INTEGER,
  research_quality_score FLOAT,
  coda_usability_rating FLOAT
);
```

**Success criteria:**
 `browser_search` is real and working (not stubbed)
 `research_quality` ≥ 0.70 on 10-topic fixture suite
 `coda_usability_rating` ≥ 0.70 rolling average after 10 Mira→Coda cycles

**Dependencies:** `browser_search` tool implementation. Coda must be running and rating inputs for Layer 3.

--

