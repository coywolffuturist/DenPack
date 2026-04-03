import { z } from 'zod';

export const DomainSchema = z.enum(['prowl', 'research', 'lucid', 'general']);
export type Domain = z.infer<typeof DomainSchema>;

export const RouteSchema = z.enum(['local', 'coywolf']);
export type Route = z.infer<typeof RouteSchema>;

export const IncomingTaskSchema = z.object({
  id: z.string().uuid().optional(),
  message: z.string(),
  context: z.record(z.unknown()).optional(),
  sessionKey: z.string().optional(),
});
export type IncomingTask = z.infer<typeof IncomingTaskSchema>;

export const ClassificationResultSchema = z.object({
  route: RouteSchema,
  domain: DomainSchema,
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});
export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;
