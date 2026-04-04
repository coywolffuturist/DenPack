import type { ClassificationResult, Domain } from './types.js';

const PROWL_KEYWORDS = ['prowl', 'strategy', 'backtest', 'position', 'trade', 'market', 'bankroll'];
const RESEARCH_KEYWORDS = ['research', 'find', 'analyze', 'report', 'summarize', 'investigate'];
const LUCID_KEYWORDS = ['lucid', 'feature', 'build', 'implement', 'fix', 'pr', 'issue', 'code'];
const ESCALATE_KEYWORDS = ['ask coywolf', 'your opinion', 'what do you think', 'architecture decision'];

const CONFIDENCE_THRESHOLD = parseFloat(process.env.CLASSIFIER_CONFIDENCE_THRESHOLD ?? '0.5');

export function classifyTask(message: string): ClassificationResult {
  const lower = message.toLowerCase();

  if (ESCALATE_KEYWORDS.some(k => lower.includes(k))) {
    return { route: 'coywolf', domain: 'general', confidence: 0.95, reason: 'explicit escalation keyword' };
  }

  const scores: Record<Domain, number> = {
    prowl: PROWL_KEYWORDS.filter(k => lower.includes(k)).length,
    research: RESEARCH_KEYWORDS.filter(k => lower.includes(k)).length,
    lucid: LUCID_KEYWORDS.filter(k => lower.includes(k)).length,
    general: 1, // baseline
  };

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const domain = sorted[0][0] as Domain;
  const topScore = sorted[0][1];
  const confidence = Math.min(0.95, topScore / 5);

  // Low confidence: no clear domain match -- escalate rather than guess
  if (confidence < CONFIDENCE_THRESHOLD) {
    return { route: 'coywolf', domain: 'general', confidence, reason: 'low confidence classification' };
  }

  return { route: 'local', domain, confidence, reason: `keyword match: ${domain}` };
}
