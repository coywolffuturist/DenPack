import type { TaskResult, Score } from './types.js';

const ESCALATION_THRESHOLD = parseFloat(process.env.ESCALATION_SCORE_THRESHOLD ?? '6.0');

export function scoreTask(result: TaskResult, expectedDomain: string): Score {
  // Correctness: heuristic — length + presence of domain keywords
  // In v1 this is rule-based; v2 will use Arbor (E4B) as judge
  const domainKeywords: Record<string, string[]> = {
    prowl:    ['strategy', 'position', 'executed', 'backtest', 'market'],
    research: ['sources', 'analysis', 'findings', 'conclusion', 'evidence'],
    lucid:    ['commit', 'test', 'function', 'component', 'pull request'],
    general:  [],
  };
  const keywords = domainKeywords[expectedDomain] ?? [];
  const outputLower = result.output.toLowerCase();
  const keywordHits = keywords.filter(k => outputLower.includes(k)).length;
  const correctness = keywords.length > 0 ? Math.min(10, (keywordHits / keywords.length) * 10) : 7;

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
