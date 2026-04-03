import express from 'express';
import { classifyTask } from './classifier.js';
import { handleTask } from '../coordinator/index.js';
import sql from '../db/client.js';
import { v4 as uuidv4 } from 'uuid';
import { IncomingTaskSchema } from './types.js';

const app = express();
app.use(express.json());

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
    INSERT INTO pack_tasks (id, domain, input) VALUES (${taskId}::uuid, ${classification.domain}, ${JSON.stringify({ message, context })})
  `;

  const result = await handleTask(taskId, classification.domain, message);

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
app.listen(PORT, () => console.log(`DenPack router listening on :${PORT}`));
