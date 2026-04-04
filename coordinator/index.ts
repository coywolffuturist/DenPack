import sql from '../db/client.js';
import path from 'path';
import { selectAgent } from './dispatcher.js';
import { scoreTask, shouldEscalate } from './evaluator.js';
import { synthesizeResponse } from './synthesizer.js';
import { buildAgentContext } from './memory-retrieval.js';
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
  const { agent, confidence } = await selectAgent(domain);
  console.log(`[arbor] dispatcher: agent=${agent}, confidence=${confidence.toFixed(3)}`);

  // 2. Build semantic memory context for this agent
  const VPS_MEMORY = process.env.VPS_MEMORY_PATH ?? '/home/ubuntu/coywolf/memory';
  const INDEX_PATH = process.env.MEMORY_INDEX_PATH ?? '/home/ubuntu/coywolf/memory/memory-index.md';
  const DEN_WORKDIR = process.env.DEN_AGENT_WORKDIR ?? '/Users/coywolfden/.denpack/agents';
  const agentDir = path.join(DEN_WORKDIR, agent, 'memory');
  const { contextPath, sectionCount, tokenEstimate } = buildAgentContext({
    agent,
    domain,
    taskText: input,
    agentDir,
    memoryRoot: VPS_MEMORY,
    indexPath: INDEX_PATH,
  });
  const memoryDir = path.dirname(contextPath);
  console.log(`[arbor] memory: ${sectionCount} sections, ~${tokenEstimate} tokens → ${contextPath}`);

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
