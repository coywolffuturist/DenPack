export function synthesizeResponse(output: string, agent: string, score: number): string {
  // Strip internal tool call blocks before returning to user
  const cleaned = output.replace(/```tool[\s\S]+?```/g, '').trim();
  return cleaned;
}
