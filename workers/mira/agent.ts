import { readFileSync } from 'fs';
import { runAgent, type AgentTask, type AgentOutput } from '../base-agent.js';

const MODEL = process.env.WORKER_MODEL_PRIMARY ?? 'gemma-4-26b-a4b-it';
const SEED = readFileSync(new URL('./seed.md', import.meta.url), 'utf8');

export async function runMira(task: Omit<AgentTask, 'systemPrompt' | 'model'>): Promise<AgentOutput> {
  return runAgent({ ...task, systemPrompt: SEED, model: MODEL });
}
