import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import OpenAI from 'openai';

const MODEL = process.env.FORGE_MODEL ?? 'deepseek-coder-v2-lite-instruct';

// Exported for testability
export function createClient(): OpenAI {
  return new OpenAI({
    baseURL: process.env.FORGE_MODEL_URL ?? process.env.LMSTUDIO_BASE_URL ?? 'http://localhost:1234/v1',
    apiKey: 'lmstudio',
  });
}

// Allows tests to inject a mock client
let _clientOverride: OpenAI | null = null;
export function _setClientForTesting(c: OpenAI | null): void { _clientOverride = c; }
function getClient(): OpenAI { return _clientOverride ?? createClient(); }

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED = readFileSync(join(__dirname, 'seed.md'), 'utf8');

export interface ForgeInput {
  taskId: string;
  chunkInstruction: string;
  implementation: string;
  modifiedFiles: string[];
  memoryDir: string;
}

export interface ForgeIssue {
  severity: 'CRITICAL' | 'IMPORTANT' | 'MINOR';
  description: string;
}

export interface ForgeOutput {
  taskId: string;
  verdict: 'APPROVE' | 'REJECT';
  score: number;
  issues: ForgeIssue[];
  reasoning: string;
  tokenCount: number;
  parseError?: boolean;
}

function parseVerdict(text: string): ForgeOutput | null {
  const verdictMatch = text.match(/VERDICT:\s*(APPROVE|REJECT)/i);
  const scoreMatch = text.match(/SCORE:\s*(\d+)/i);
  const reasoningMatch = text.match(/REASONING:\s*([\s\S]+?)(?:\n\n|$)/i);

  if (!verdictMatch) return null;

  const issueMatches = [...text.matchAll(/- \[(CRITICAL|IMPORTANT|MINOR)\]\s*(.+)/gi)];
  const issues: ForgeIssue[] = issueMatches.map(m => ({
    severity: m[1].toUpperCase() as ForgeIssue['severity'],
    description: m[2].trim(),
  }));

  return {
    taskId: '',
    verdict: verdictMatch[1].toUpperCase() as 'APPROVE' | 'REJECT',
    score: scoreMatch ? Math.min(10, Math.max(1, parseInt(scoreMatch[1]))) : 5,
    issues,
    reasoning: reasoningMatch?.[1]?.trim() ?? '',
    tokenCount: 0,
  };
}

export async function runForge(input: ForgeInput): Promise<ForgeOutput> {
  const checklist = (() => {
    try {
      return readFileSync(join(__dirname, 'review-checklist.md'), 'utf8');
    } catch {
      return '';
    }
  })();

  const userMessage = [
    `## Chunk Instruction`,
    input.chunkInstruction,
    `## Modified Files`,
    input.modifiedFiles.join(', ') || '(none listed)',
    `## Implementation`,
    '```',
    input.implementation,
    '```',
    checklist ? `## Additional Review Checklist\n${checklist}` : '',
  ].filter(Boolean).join('\n\n');

  const response = await getClient().chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: SEED },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.2,
    max_tokens: 1000,
  });

  const text = response.choices[0]?.message?.content ?? '';
  const tokenCount = response.usage?.total_tokens ?? 0;
  const parsed = parseVerdict(text);

  if (!parsed) {
    return {
      taskId: input.taskId,
      verdict: 'REJECT',
      score: 1,
      issues: [{ severity: 'CRITICAL', description: 'Forge could not parse its own output — treating as rejection' }],
      reasoning: text,
      tokenCount,
      parseError: true,
    };
  }

  return { ...parsed, taskId: input.taskId, tokenCount };
}
