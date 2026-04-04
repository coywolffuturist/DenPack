import type { TaskResult, Score } from './types.js';

const ESCALATION_THRESHOLD = parseFloat(process.env.ESCALATION_SCORE_THRESHOLD ?? '6.0');

export function scoreTask(result: TaskResult, expectedDomain: string): Score {
  // Correctness: heuristic — keyword presence for domain tasks, length proxy for general
  // In v2 this will use Arbor (E4B) as LLM judge
  const domainKeywords: Record<string, string[]> = {
    prowl:    ['strategy', 'position', 'executed', 'backtest', 'market'],
    research: ['sources', 'analysis', 'findings', 'conclusion', 'evidence'],
    lucid:    ['commit', 'test', 'function', 'component', 'pull request'],
    general:  [],
  };
  const keywords = domainKeywords[expectedDomain] ?? [];
  const outputLower = result.output.toLowerCase();
  const keywordHits = keywords.filter(k => outputLower.includes(k)).length;

  let correctness: number;
  if (keywords.length > 0) {
    correctness = Math.min(10, (keywordHits / keywords.length) * 10);
  } else {
    // General domain: score by output length as a proxy for substantiveness
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
