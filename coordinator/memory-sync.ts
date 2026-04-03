import { execSync } from 'child_process';
import { mkdirSync } from 'fs';
import path from 'path';

const VPS_MEMORY = process.env.VPS_MEMORY_PATH ?? '/home/ubuntu/coywolf/memory';
const DEN_WORKDIR = process.env.DEN_AGENT_WORKDIR ?? '/Users/coywolfden/.denpack/agents';

// Files each agent receives at task dispatch
const AGENT_MEMORY_FILES: Record<string, string[]> = {
  lumen: ['entities/prowl-strategies.md', 'PROJECTS.md'],
  vex:   ['entities/prowl-strategies.md', 'reference/GOALS.md'],
  mira:  ['PROJECTS.md', 'reference/GOALS.md', 'entities/Brendan-Joyce.md'],
  coda:  ['PROJECTS.md', 'reference/GOALS.md'],
  sable: ['PROJECTS.md', 'entities/coywolf repo.md'],
};

export async function syncMemoryForAgent(agent: string): Promise<string> {
  const files = AGENT_MEMORY_FILES[agent] ?? [];
  const agentDir = path.join(DEN_WORKDIR, agent, 'memory');
  mkdirSync(agentDir, { recursive: true });

  for (const file of files) {
    const src = path.join(VPS_MEMORY, file);
    const dst = path.join(agentDir, path.basename(file));
    try {
      execSync(`cp "${src}" "${dst}"`, { stdio: 'pipe' });
    } catch {
      console.warn(`memory-sync: could not copy ${file} — skipping`);
    }
  }

  return agentDir;
}
