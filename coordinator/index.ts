import sql from '../db/client.js';
import { selectAgent } from './dispatcher.js';
import { scoreTask, shouldEscalate } from './evaluator.js';
import { synthesizeResponse } from './synthesizer.js';
import { syncMemoryForAgent } from './memory-sync.js';
import { runLumen } from '../workers/lumen/agent.js';
import { runVex } from '../workers/vex/agent.js';
import { runMira } from '../workers/mira/agent.js';
import { runCoda } from '../workers/coda/agent.js';
import { runSable } from '../workers/sable/agent.js';
import type { AgentName, TaskResult } from './types.js';
import type { AgentTask } from '../workers/base-agent.js';

type AgentRunner = (t: Omit<AgentTask, 'systemPrompt' | 'model'>) => Promise<TaskResult>;

const AGENT_RUNNERS: Record<AgentName, AgentRunner> = {
  lumen: runLumen as AgentRunner,
  vex:   runVex as AgentRunner,
  mira:  runMira as AgentRunner,
  coda:  runCoda as AgentRunner,
  sable: runSable as AgentRunner,
};

export async function handleTask(taskId: string, domain: string, input: string): Promise<string> {
  // 1. Select best agent
  const agent = await selectAgent(domain);

  // 2. Sync memory to Den for this agent
  const memoryDir = await syncMemoryForAgent(agent);

  // 3. Mark assigned
  await sql`UPDATE pack_tasks SET status='assigned', assigned_to=${agent} WHERE id=${taskId}::uuid`;

  // 4. Run agent
  const runner = AGENT_RUNNERS[agent];
  const result: TaskResult = await runner({ taskId, domain, input, memoryDir });

  // 5. Score
  const score = scoreTask(result, domain);

  // 6. Escalate if below threshold
  if (shouldEscalate(score)) {
    await sql`UPDATE pack_tasks SET status='escalated', score=${JSON.stringify(score)} WHERE id=${taskId}::uuid`;
    return '__ESCALATE__';
  }

  // 7. Store result + score
  await sql`
    UPDATE pack_tasks SET status='complete', output=${JSON.stringify({ text: result.output })},
    score=${JSON.stringify(score)} WHERE id=${taskId}::uuid
  `;
  await sql`
    INSERT INTO pack_scores (task_id, agent_id, domain, correctness, efficiency, handoff, composite)
    VALUES (${taskId}::uuid, ${agent}, ${domain}, ${score.correctness}, ${score.efficiency}, ${score.handoff}, ${score.composite})
  `;

  // 8. Update agent profile
  await sql`
    INSERT INTO pack_agent_profiles (agent_id, model, total_tasks, avg_composite_score, last_active)
    VALUES (${agent}, 'gemma-4-26b-a4b-it', 1, ${score.composite}, now())
    ON CONFLICT (agent_id) DO UPDATE SET
      total_tasks = pack_agent_profiles.total_tasks + 1,
      avg_composite_score = (pack_agent_profiles.avg_composite_score * pack_agent_profiles.total_tasks + ${score.composite}) / (pack_agent_profiles.total_tasks + 1),
      last_active = now()
  `;

  // 9. Synthesize + return
  return synthesizeResponse(result.output, agent, score.composite);
}
