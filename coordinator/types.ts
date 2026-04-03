export type AgentName = 'lumen' | 'vex' | 'mira' | 'coda' | 'sable';

export interface AgentProfile {
  agent_id: AgentName;
  model: string;
  scores_by_domain: Record<string, number>;
  total_tasks: number;
  avg_composite_score: number;
  last_active: string | null;
}

export interface Score {
  correctness: number;
  efficiency: number;
  handoff: number;
  composite: number;
}

export interface TaskAssignment {
  taskId: string;
  agent: AgentName;
  domain: string;
  input: unknown;
  memoryFiles: string[];
}

export interface TaskResult {
  taskId: string;
  agent: AgentName;
  output: string;
  toolCallCount: number;
  tokenCount: number;
}
