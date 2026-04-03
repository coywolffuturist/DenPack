import { readFileSync } from 'fs';
import { runAgent, type AgentTask, type AgentOutput } from '../base-agent.js';

const MODEL = process.env.WORKER_MODEL_CODER ?? 'qwen2.5-coder-7b-instruct-mlx';
const SEED = readFileSync(new URL('./seed.md', import.meta.url), 'utf8');

export async function runSable(task: Omit<AgentTask, 'systemPrompt' | 'model'>): Promise<AgentOutput> {
  return runAgent({ ...task, systemPrompt: SEED, model: MODEL });
}
