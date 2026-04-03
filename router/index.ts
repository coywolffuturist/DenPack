import express from 'express';
import { classifyTask } from './classifier.js';
import sql from '../db/client.js';
import { v4 as uuidv4 } from 'uuid';
import { IncomingTaskSchema } from './types.js';

const app = express();
app.use(express.json());

const COORDINATOR_URL = process.env.COORDINATOR_URL ?? 'http://localhost:3848';

async function dispatchToCoordinator(taskId: string, domain: string, input: string): Promise<string> {
  const res = await fetch(`${COORDINATOR_URL}/task`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ taskId, domain, input }),
  });

  if (!res.ok) {
    throw new Error(`Coordinator returned ${res.status}: ${await res.text()}`);
  }

  const body = await res.json() as { result: string };
  return body.result;
}

app.post('/task', async (req, res) => {
  const parsed = IncomingTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const { message, context } = parsed.data;
  const classification = classifyTask(message);

  if (classification.route === 'coywolf') {
    res.json({ route: 'coywolf', reason: classification.reason });
    return;
  }

  const taskId = uuidv4();
  await sql`
    INSERT INTO pack_tasks (id, domain, input)
    VALUES (${taskId}::uuid, ${classification.domain}, ${JSON.stringify({ message, context })})
  `;

  let result: string;
  try {
    result = await dispatchToCoordinator(taskId, classification.domain, message);
  } catch (err) {
    console.error('[router] coordinator dispatch failed:', err);
    res.status(502).json({ route: 'coywolf', reason: 'coordinator unavailable', taskId });
    return;
  }

  if (result === '__ESCALATE__') {
    res.json({ route: 'coywolf', reason: 'score below threshold', taskId });
    return;
  }

  res.json({ route: 'local', result, taskId, domain: classification.domain });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.ROUTER_PORT ?? 3847;
app.listen(PORT, () => console.log(`[router] DenPack router listening on :${PORT}`));
