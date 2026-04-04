import sql from '../db/client.js';
import type { AgentName } from './types.js';

const DOMAIN_AGENT_MAP: Record<string, AgentName[]> = {
  prowl:    ['lumen', 'vex'],
  research: ['mira', 'coda'],
  lucid:    ['sable'],
  general:  ['mira', 'lumen'],
};

type AgentProfile = { agent_id: string; scores_by_domain: Record<string, number>; avg_composite_score: number };

export async function selectAgent(domain: string): Promise<{ agent: AgentName; confidence: number }> {
  const candidates = DOMAIN_AGENT_MAP[domain] ?? ['mira'];

  // Fetch profiles for all candidates
  const rows = (await sql`
    SELECT agent_id, scores_by_domain, avg_composite_score
    FROM pack_agent_profiles
    WHERE agent_id = ANY(${candidates})
  `) as AgentProfile[];

  if (rows.length === 0) return { agent: candidates[0], confidence: 1.0 };

  // Score each candidate: prefer domain-specific score, fall back to overall
  const scored = rows.map(row => ({
    agent_id: row.agent_id as AgentName,
    score: (row.scores_by_domain as Record<string, number>)?.[domain] ?? row.avg_composite_score,
  }));

  scored.sort((a, b) => b.score - a.score);

  const topScore = scored[0].score;
  const secondScore = scored.length > 1 ? scored[1].score : 0;

  // Confidence: ratio of top score to sum of top + runner-up
  const confidence = secondScore === 0
    ? 1.0
    : topScore / (topScore + secondScore);

  const agent = scored[0].agent_id;

  // Log low-confidence routing decisions to pack_scores
  if (confidence < 0.6) {
    try {
      await sql`
        INSERT INTO pack_scores (task_id, agent_id, domain, correctness, efficiency, handoff, composite, flag)
        VALUES (gen_random_uuid(), ${agent}, ${domain}, 0, 0, 0, 0, 'low_confidence')
      `;
    } catch (err) {
      // Column may not exist yet (pre-migration); log to console as fallback
      console.warn(`[dispatcher] low_confidence routing (${agent}, domain=${domain}, confidence=${confidence.toFixed(3)}):`, err);
    }
  }

  return { agent, confidence };
}
