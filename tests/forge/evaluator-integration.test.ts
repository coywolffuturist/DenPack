import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock forge agent
vi.mock('../../workers/forge/agent.js', () => ({
  runForge: vi.fn().mockResolvedValue({
    taskId: 'test-1',
    verdict: 'APPROVE',
    score: 8,
    issues: [],
    reasoning: 'looks good',
    tokenCount: 100,
  }),
  _setClientForTesting: vi.fn(),
  createClient: vi.fn(),
}));

// Mock DB client
vi.mock('../../db/client.js', () => ({
  default: Object.assign(
    vi.fn().mockResolvedValue([{ id: 'uuid-1', verdict: 'APPROVE' }]),
    { query: vi.fn() }
  )
}));

describe('evaluator forge integration', () => {
  it('exports runForgeReview function', async () => {
    const mod = await import('../../coordinator/evaluator.js');
    expect(typeof mod.runForgeReview).toBe('function');
  });

  it('exports recordForgeOutcome function', async () => {
    const mod = await import('../../coordinator/evaluator.js');
    expect(typeof mod.recordForgeOutcome).toBe('function');
  });

  it('runForgeReview calls runForge and returns ForgeOutput', async () => {
    const { runForgeReview } = await import('../../coordinator/evaluator.js');
    const result = await runForgeReview({
      taskId: 'test-1',
      chunkInstruction: 'Write add()',
      implementation: 'function add(a,b){return a+b}',
      modifiedFiles: ['src/math.ts'],
      memoryDir: '/tmp',
    });
    expect(result.verdict).toBe('APPROVE');
    expect(result.score).toBe(8);
  });
});
