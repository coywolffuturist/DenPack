import express from 'express';
import { z } from 'zod';
import { handleTask } from './index.js';

// Schema for incoming task from router
const TaskSchema = z.object({
  taskId: z.string(),
  domain: z.string(),
  input:  z.string(),
});

export function createCoordinatorApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/task', async (req, res) => {
    const parsed = TaskSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const { taskId, domain, input } = parsed.data;
    try {
      const result = await handleTask(taskId, domain, input);
      res.json({ result });
    } catch (err) {
      console.error('[coordinator] task error:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  return app;
}

// Only start server when run directly (not when imported for testing)
const isMain = process.argv[1]?.includes('coordinator/server');
if (isMain) {
  const PORT = parseInt(process.env.COORDINATOR_PORT ?? '3848', 10);
  createCoordinatorApp().listen(PORT, () =>
    console.log(`[arbor] coordinator listening on :${PORT}`)
  );
}
