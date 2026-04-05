import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ForgeInput } from '../../workers/forge/agent.js';

// Build a mock OpenAI-compatible client
function makeMockClient(content: string, tokens = 100) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content } }],
          usage: { total_tokens: tokens }
        })
      }
    }
  } as unknown as import('openai').default;
}

describe('runForge', () => {
  afterEach(async () => {
    const { _setClientForTesting } = await import('../../workers/forge/agent.js');
    _setClientForTesting(null);
  });

  it('parses APPROVE verdict correctly', async () => {
    const { runForge, _setClientForTesting } = await import('../../workers/forge/agent.js');
    _setClientForTesting(makeMockClient('VERDICT: APPROVE\nSCORE: 8\nISSUES:\n- [MINOR] small thing\nREASONING: looks good'));

    const result = await runForge({
      taskId: 'test-1',
      chunkInstruction: 'Write a function that adds two numbers',
      implementation: 'function add(a, b) { return a + b; }',
      modifiedFiles: ['src/math.ts'],
      memoryDir: '/tmp'
    });

    expect(result.verdict).toBe('APPROVE');
    expect(result.score).toBe(8);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe('MINOR');
    expect(result.parseError).toBeUndefined();
  });

  it('parses REJECT verdict correctly', async () => {
    const { runForge, _setClientForTesting } = await import('../../workers/forge/agent.js');
    _setClientForTesting(makeMockClient('VERDICT: REJECT\nSCORE: 3\nISSUES:\n- [CRITICAL] missing null check\nREASONING: will crash on null input', 80));

    const result = await runForge({
      taskId: 'test-2',
      chunkInstruction: 'Handle null input',
      implementation: 'function f(x) { return x.value; }',
      modifiedFiles: ['src/f.ts'],
      memoryDir: '/tmp'
    });

    expect(result.verdict).toBe('REJECT');
    expect(result.score).toBe(3);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe('CRITICAL');
    expect(result.issues[0].description).toBe('missing null check');
  });

  it('defaults to REJECT on unparseable output', async () => {
    const { runForge, _setClientForTesting } = await import('../../workers/forge/agent.js');
    _setClientForTesting(makeMockClient('I cannot determine the verdict', 20));

    const result = await runForge({
      taskId: 'test-3',
      chunkInstruction: 'anything',
      implementation: 'anything',
      modifiedFiles: [],
      memoryDir: '/tmp'
    });

    expect(result.verdict).toBe('REJECT');
    expect(result.parseError).toBe(true);
    expect(result.issues[0].severity).toBe('CRITICAL');
  });
});
