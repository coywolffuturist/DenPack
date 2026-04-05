import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import type { TaskResult, Score } from './types.js';
import sql from '../db/client.js';
import { runForge, type ForgeInput, type ForgeOutput } from '../workers/forge/agent.js';

const ESCALATION_THRESHOLD = parseFloat(process.env.ESCALATION_SCORE_THRESHOLD ?? '6.0');

interface RubricCriterion {
  name: string;
  weight: number;
  signal: string;
}

interface Rubric {
  domain: string;
  criteria: RubricCriterion[];
}

function loadRubric(domain: string): Rubric | null {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const rubricPath = join(__dirname, 'rubrics', `${domain}.json`);
    const raw = readFileSync(rubricPath, 'utf8');
    return JSON.parse(raw) as Rubric;
  } catch {
    return null;
  }
}

/**
 * Score a single rubric criterion against the output text.
 * Returns 0–10: 10 if the signal is satisfied, 0 if not.
 * Uses signal-specific heuristics (regex/keyword checks tied to the signal description).
 */
function scoreCriterion(criterion: RubricCriterion, output: string): number {
  const lower = output.toLowerCase();

  switch (criterion.name) {
    // ── prowl ──────────────────────────────────────────────────────────────
    case 'edge_identified':
      // numeric percentage or decimal probability
      return /\b\d{1,3}%|\b0\.\d+\b/.test(output) ? 10 : 0;

    case 'position_sizing':
      // kelly, position size, bankroll
      return /kelly|position size|bankroll|stake size|fraction of|% of (bank|roll|portfolio)/i.test(output) ? 10 : 0;

    case 'venue_selected':
      // specific prediction-market venue or market name
      return /polymarket|kalshi|manifold|augur|gnosis|specific market/i.test(output) ? 10 : 0;

    case 'reasoning_shown': {
      // prowl & general — explains why
      const reasoningPatterns = /\b(because|therefore|since|given that|reason|rationale|explains?|why|due to|hence|thus)\b/i;
      return reasoningPatterns.test(output) ? 10 : 0;
    }

    // ── research ───────────────────────────────────────────────────────────
    case 'source_cited':
      // URL, "according to", named publication, doi, ibid, op.cit.
      return /(https?:\/\/|according to|source:|reference:|cited|doi:|see also|\[\d+\])/i.test(output) ? 10 : 0;

    case 'claim_supported':
      // data, statistics, percentage, or quoted evidence
      return /\b\d+(\.\d+)?%|\bstatistic|data shows?|study (found|shows)|evidence|survey|report(ed)?|figure[s]?\b/i.test(output) ? 10 : 0;

    case 'conclusion_clear':
      // conclusion, finding, summary
      return /\b(conclusion|finding|in summary|to summarize|overall|in short|result[s]?|takeaway)\b/i.test(output) ? 10 : 0;

    case 'uncertainty_acknowledged':
      // uncertainty, limitations, caveats
      return /\b(uncertain|unclear|caveat|limitation|however|although|but|may|might|could|possibly|arguably|not (certain|sure)|unknown)\b/i.test(output) ? 10 : 0;

    // ── lucid ──────────────────────────────────────────────────────────────
    case 'code_change_described':
      // code, diff, implement, refactor, fix, patch
      return /\b(commit|diff|implement|refactor|function|method|class|fix|patch|change[sd]?|update[sd]?|rewrite|added?|removed?)\b/i.test(output) ? 10 : 0;

    case 'file_identified':
      // file path patterns: .ts, .js, .py, /path/to/, or explicit "file:"
      return /\.(ts|js|py|go|rs|json|yaml|yml|md|css|html|sh)\b|\/[\w\-]+\/|file:/i.test(output) ? 10 : 0;

    case 'test_mentioned':
      // test, spec, unit test, coverage
      return /\b(test[s]?|spec[s]?|unit test|integration test|coverage|jest|vitest|mocha|pytest|assert)\b/i.test(output) ? 10 : 0;

    case 'no_regression_noted':
      // no regression, backward compat, existing behavior preserved
      return /\b(no regression|backward compat|existing (behaviour|behavior)|doesn['']t break|non[-\s]?breaking|all tests pass|green)\b/i.test(output) ? 10 : 0;

    // ── general ────────────────────────────────────────────────────────────
    case 'question_answered':
      // At least a substantive response (>80 chars) that doesn't open with a refusal
      return output.length > 80 && !/^(i (can['']t|cannot|don['']t know)|sorry|unfortunately)/i.test(output) ? 10 : 0;

    case 'actionable':
      // recommendation, next step, concrete action
      return /\b(recommend|suggest|you should|next step|action|try|consider|use|run|execute|implement|deploy)\b/i.test(output) ? 10 : 0;

    default:
      // Unknown criterion: score by presence of any content
      return lower.length > 50 ? 5 : 0;
  }
}

export function scoreTask(result: TaskResult, expectedDomain: string): Score {
  const outputLower = result.output.toLowerCase();
  let correctness: number;

  const rubric = loadRubric(expectedDomain);

  if (rubric) {
    // Rubric-based scoring: weighted average of criterion scores
    const weightedSum = rubric.criteria.reduce((sum, criterion) => {
      const criterionScore = scoreCriterion(criterion, result.output);
      return sum + criterionScore * criterion.weight;
    }, 0);
    correctness = Math.min(10, weightedSum);
  } else {
    // Fallback: length-based proxy for unknown domains
    // < 100 chars = likely a non-answer -> 3.0
    // 100-500 chars -> 6.0
    // 500-2000 chars -> 8.0
    // > 2000 chars -> 9.0
    const len = result.output.length;
    if (len < 100) correctness = 3.0;
    else if (len < 500) correctness = 6.0;
    else if (len < 2000) correctness = 8.0;
    else correctness = 9.0;
  }

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

// ── Forge integration ──────────────────────────────────────────────────────

export async function runForgeReview(input: ForgeInput): Promise<ForgeOutput> {
  const result = await runForge(input);

  // Persist to DB (non-fatal if it fails)
  try {
    await sql`
      INSERT INTO pack_forge_reviews
        (chunk_id, verdict, score, issues, reasoning, token_count, parse_error, test_outcome)
      VALUES
        (${input.taskId}, ${result.verdict}, ${result.score}, ${JSON.stringify(result.issues)},
         ${result.reasoning}, ${result.tokenCount}, ${result.parseError ?? false}, 'pending')
    `;
  } catch (err) {
    console.error('[evaluator] forge db write failed:', err);
  }

  return result;
}

export async function recordForgeOutcome(chunkId: string, testOutcome: 'pass' | 'fail'): Promise<void> {
  // Fetch latest review for this chunk
  const rows = await sql`
    SELECT id, verdict FROM pack_forge_reviews
    WHERE chunk_id = ${chunkId} AND test_outcome = 'pending'
    ORDER BY reviewed_at DESC LIMIT 1
  `;
  if (!rows.length) return;

  const { id, verdict } = rows[0] as { id: string; verdict: string };
  const label =
    verdict === 'APPROVE' && testOutcome === 'pass' ? 'true_positive' :
    verdict === 'REJECT'  && testOutcome === 'fail' ? 'true_negative' :
    verdict === 'APPROVE' && testOutcome === 'fail' ? 'false_negative' :
    'false_positive';

  // Compute rolling F1 from last 50 labeled reviews
  const history = await sql`
    SELECT label FROM pack_forge_reviews
    WHERE label IS NOT NULL
    ORDER BY reviewed_at DESC LIMIT 50
  ` as { label: string }[];

  const tp = history.filter(r => r.label === 'true_positive').length;
  const fp = history.filter(r => r.label === 'false_positive').length;
  const fn = history.filter(r => r.label === 'false_negative').length;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall    = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  await sql`
    UPDATE pack_forge_reviews
    SET test_outcome = ${testOutcome}, label = ${label}, f1_rolling = ${f1}
    WHERE id = ${id}
  `;
}
