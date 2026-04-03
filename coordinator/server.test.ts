import { strict as assert } from 'assert';
import http from 'http';

async function startTestServer(): Promise<{ server: http.Server; port: number }> {
  process.env.COORDINATOR_PORT = '0'; // random port
  // Neon validates the URL format at import time — must look like a real connection string
  process.env.NEON_DATABASE_URL = process.env.NEON_DATABASE_URL ?? 'postgresql://user:pass@host.example.com/dbname';
  process.env.VPS_MEMORY_PATH = '/tmp/test-memory';
  process.env.MEMORY_INDEX_PATH = '/tmp/test-memory/memory-index.md';
  process.env.DEN_AGENT_WORKDIR = '/tmp/test-agents';

  // We can't easily mock handleTask in ESM without a mocking library.
  // Instead, test /health only (safe, no DB/LM calls), and verify /task
  // shape validation (rejects bad input with 400).
  const { createCoordinatorApp } = await import('./server.js');
  const app = createCoordinatorApp();
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

async function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// Test 1: /health returns 200 ok
let srv: http.Server;
let port: number;

({ server: srv, port } = await startTestServer());

const healthRes = await fetch(`http://localhost:${port}/health`);
assert.equal(healthRes.status, 200);
const healthBody = await healthRes.json() as { status: string };
assert.equal(healthBody.status, 'ok');
await stopServer(srv);
console.log('✅ Test 1: /health returns ok');

// Test 2: /task rejects missing fields with 400
({ server: srv, port } = await startTestServer());

const badRes = await fetch(`http://localhost:${port}/task`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ wrong: 'shape' }),
});
assert.equal(badRes.status, 400);
await stopServer(srv);
console.log('✅ Test 2: /task rejects bad input with 400');

// Test 3: /task accepts valid shape (taskId, domain, input)
// We just verify it parses correctly — it will fail at DB/LM stage which is expected in test env.
({ server: srv, port } = await startTestServer());

const validRes = await fetch(`http://localhost:${port}/task`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ taskId: 'test-123', domain: 'prowl', input: 'test task' }),
});
// Will get 500 (DB not available in test) or 200 — either is fine, just not 400
assert.notEqual(validRes.status, 400);
await stopServer(srv);
console.log('✅ Test 3: /task accepts valid shape');

console.log('\n✅ All coordinator server tests passed');
