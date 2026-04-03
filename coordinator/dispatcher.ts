import sql from '../db/client.js';
import type { AgentName } from './types.js';

const DOMAIN_AGENT_MAP: Record<string, AgentName[]> = {
  prowl:    ['lumen', 'vex'],
  research: ['mira', 'coda'],
  lucid:    ['sable'],
  general:  ['mira', 'lumen'],
};

export async function selectAgent(domain: string): Promise<AgentName> {
  const candidates = DOMAIN_AGENT_MAP[domain] ?? ['mira'];

  const rows = await sql`
    SELECT agent_id, scores_by_domain, avg_composite_score
    FROM pack_agent_profiles
    WHERE agent_id = ANY(${candidates})
    ORDER BY avg_composite_score DESC
    LIMIT 1
  `;

  if (rows.length > 0) return rows[0].agent_id as AgentName;
  // Default: first candidate (no profile yet = equal footing)
  return candidates[0];
}
