import sql from '../db/client.js';
import type { AgentName } from './types.js';

const DOMAIN_AGENT_MAP: Record<string, AgentName[]> = {
  prowl:    ['lumen', 'vex'],
  research: ['mira', 'coda'],
  lucid:    ['sable'],
  general:  ['mira', 'lumen'],
};

type AgentProfile = { agent_id: string; scores_by_domain: Record<string, number>; avg_composite_score: number };

export async function selectAgent(domain: string): Promise<AgentName> {
  const candidates = DOMAIN_AGENT_MAP[domain] ?? ['mira'];

  // Fetch profiles for all candidates
  const rows = (await sql`
    SELECT agent_id, scores_by_domain, avg_composite_score
    FROM pack_agent_profiles
    WHERE agent_id = ANY(${candidates})
  `) as AgentProfile[];

  if (rows.length === 0) return candidates[0];

  // Score each candidate: prefer domain-specific score, fall back to overall
  const scored = rows.map(row => ({
    agent_id: row.agent_id as AgentName,
    score: (row.scores_by_domain as Record<string, number>)?.[domain] ?? row.avg_composite_score,
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored[0].agent_id;
}
