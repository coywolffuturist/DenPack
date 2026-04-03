import OpenAI from 'openai';
import { executeTool, type ToolCall } from './tool-runtime.js';

const client = new OpenAI({ baseURL: process.env.LMSTUDIO_BASE_URL ?? 'http://localhost:1234/v1', apiKey: 'lmstudio' });

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
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: task.systemPrompt },
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
    const content = choice.message.content ?? '';
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
