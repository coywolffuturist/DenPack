import OpenAI from 'openai';
import { execSync } from 'child_process';
import { executeTool, type ToolCall } from './tool-runtime.js';

const client = new OpenAI({ baseURL: process.env.LMSTUDIO_BASE_URL ?? 'http://localhost:1234/v1', apiKey: 'lmstudio' });

/**
 * Builds a markdown environment snapshot injected at agent startup.
 * Gives the agent immediate orientation without wasting turns.
 */
function buildEnvSnapshot(tools: string[]): string {
  const timestamp = new Date().toISOString();
  const cwd = (() => { try { return execSync('pwd', { encoding: 'utf8' }).trim(); } catch { return process.cwd(); } })();
  const topLevelFiles = (() => {
    try { return execSync('ls', { cwd, encoding: 'utf8' }).trim().split('\n').join(', '); }
    catch { return '(unavailable)'; }
  })();
  return [
    '## Environment Snapshot',
    `- **Timestamp:** ${timestamp}`,
    `- **Working directory:** ${cwd}`,
    `- **Top-level files:** ${topLevelFiles}`,
    `- **Available tools:** ${tools.length > 0 ? tools.join(', ') : '(none)'}`,
  ].join('\n');
}

export interface AgentTask {
  taskId: string;
  domain: string;
  input: string;
  memoryDir: string;
  systemPrompt: string;
  model: string;
}

export interface AgentOutput {
  taskId: string;
  output: string;
  toolCallCount: number;
  tokenCount: number;
}

export async function runAgent(task: AgentTask): Promise<AgentOutput> {
  const envSnapshot = buildEnvSnapshot([]);
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: `${envSnapshot}\n\n${task.systemPrompt}` },
    { role: 'user', content: task.input },
  ];

  let toolCallCount = 0;
  let totalTokens = 0;
  const MAX_TURNS = 10;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await client.chat.completions.create({
      model: task.model,
      messages,
      max_tokens: 4096,
    });

    const choice = resp.choices[0];
    totalTokens += resp.usage?.total_tokens ?? 0;
    // Some local models (Qwen3 with thinking) return content in reasoning_content
    const rawContent = choice.message.content ?? '';
    const reasoning = (choice.message as unknown as Record<string, string>)['reasoning_content'] ?? '';
    const content = rawContent || reasoning;
    messages.push({ role: 'assistant', content });

    // Check for tool call JSON blocks
    const toolMatch = content.match(/```tool\n([\s\S]+?)\n```/);
    if (!toolMatch || choice.finish_reason === 'stop') {
      return { taskId: task.taskId, output: content, toolCallCount, tokenCount: totalTokens };
    }

    const toolCall = JSON.parse(toolMatch[1]) as ToolCall;
    toolCallCount++;
    const result = await executeTool(toolCall, task.memoryDir);
    messages.push({ role: 'user', content: `Tool result:\n${result.output}` });
  }

  const lastMsg = messages[messages.length - 1];
  const lastContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
  return {
    taskId: task.taskId,
    output: lastContent,
    toolCallCount,
    tokenCount: totalTokens,
  };
}
