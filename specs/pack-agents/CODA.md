# Coda — Eval Stack & Build Plan
*DenPack Pack Agent Spec · Version 1.0 · 2026-04-04*

**Role:** Report Synthesis — produces structured summaries, analysis, and documentation from pack output.

### Coda (Report Synthesis)

**Role:** Takes Mira's structured research findings and synthesizes them into final reports for Coywolf.

#### Eval Stack — Current State

| Layer | What's Tested Today | Signal Quality |
|-------|---------------------|----------------|
| Unit | None | 0/10 |
| Signal | None | 0/10 |
| Outcome | None | 0/10 |

#### Eval Stack — Target

**Layer 1 — Unit (Input Handling)**
 Test: Given a valid Mira output JSON, does Coda produce a report that includes all required sections?
  - Required sections: `Executive Summary`, `Key Findings`, `Evidence`, `Gaps & Limitations`, `Recommended Actions`
  - Formula: `section_coverage = present_sections / required_sections`
  - Threshold: ≥ 1.0 (all sections required)

**Layer 2 — Signal (Report Quality Rubric)**

| Criterion | Weight | Signal |
|-----------|--------|--------|
| Fidelity to source | 0.30 | % of Coda's claims that trace back to a Mira finding (no hallucination). Formula: `traceable_claims / coda_claims`. Threshold sub-score: ≥ 0.90 |
| Compression ratio | 0.20 | `mira_word_count / coda_word_count`. Target ratio: 3–6×. Score: `1.0` if in range, `0.5` if ratio 2–3× or 6–10×, `0.0` otherwise |
| Actionability | 0.25 | Does `Recommended Actions` section contain ≥ 2 items with verifiable next steps? Score: `min(action_count/2, 1.0)` |
| Readability | 0.25 | Flesch-Kincaid readability score ≥ 50 (accessible to general audience). Binary: 1 or 0 |

 Formula: `report_quality = sum(criterion_score × weight)`
 Threshold: ≥ 0.70

**Layer 3 — Outcome (Coywolf Rating)**
 Coywolf rates each delivered report 1–5
 Coda score: `report_rating / 5`
 Rolling average over last 10 reports
 Threshold: ≥ 0.70

#### Build Plan

**New file: `workers/coda/context.md`**
 Output schema requirement (5 required sections)
 Compression target (3–6×)
 Fidelity requirement (no claims without Mira source)

**New file: `coordinator/rubrics/coda.json`**
 Rubric JSON for Arbor to apply Layer 2 scoring

**New file: `workers/coda/report-validator.ts`**
 Validates report sections
 Computes fidelity score by cross-referencing Coda claims against Mira findings
 Computes word counts and compression ratio
 Runs Flesch-Kincaid on report text

**Modify: `db/schema.sql`**
```sql
CREATE TABLE pack_coda_reports (
  id SERIAL PRIMARY KEY,
  mira_output_id INTEGER REFERENCES pack_mira_outputs(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  report_text TEXT,
  section_coverage FLOAT,
  fidelity_score FLOAT,
  compression_ratio FLOAT,
  action_count INTEGER,
  readability_score FLOAT,
  report_quality_score FLOAT,
  coywolf_rating FLOAT
);
```

**Success criteria:**
 Section coverage = 1.0 on all reports (zero missing sections)
 `report_quality` ≥ 0.70 on 10-report fixture suite
 `coywolf_rating` ≥ 0.70 rolling average after 10 delivered reports

**Dependencies:** Mira must be producing structured output (Layer 1 complete). Coywolf must be rating reports (creates `coywolf_rating` signal).

--

