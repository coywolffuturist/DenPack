import { execSync, execFileSync } from 'child_process';

export type ToolCall = {
  tool: 'exec' | 'gh' | 'read_memory' | 'browser_search' | 'neon_query';
  [key: string]: unknown;
};

export type ToolResult = { success: boolean; output: string };

export async function executeTool(call: ToolCall, memoryDir: string): Promise<ToolResult> {
  try {
    switch (call.tool) {
      case 'exec': {
        const out = execSync(String(call.command), { encoding: 'utf8', timeout: 30000 });
        return { success: true, output: out };
      }
      case 'gh': {
        const args = (call.args as string[]) ?? [];
        const out = execFileSync('gh', args, { encoding: 'utf8', timeout: 30000 });
        return { success: true, output: out };
      }
      case 'read_memory': {
        const { readFileSync } = await import('fs');
        const p = `${memoryDir}/${call.file as string}`;
        return { success: true, output: readFileSync(p, 'utf8') };
      }
      case 'browser_search': {
        // Calls Den Chrome CDP search -- stubbed; full impl in search-proxy
        return { success: false, output: 'browser_search: not yet implemented' };
      }
      case 'neon_query': {
        const query = (call.query as string ?? '').trim();
        // Strip leading SQL comments before checking intent
        const stripped = query.replace(/^(--[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/i, '').trimStart();
        if (!/^SELECT\s/i.test(stripped)) {
          return { success: false, output: 'neon_query: only SELECT statements are permitted' };
        }
        const sqlClient = (await import('../db/client.js')).default;
        // Use ordinary function call (not template tag) to pass raw query string
        const rows = await sqlClient(query);
        return { success: true, output: JSON.stringify(rows) };
      }
      default: {
        const c = call as ToolCall;
        return { success: false, output: `Unknown tool: ${c.tool}` };
      }
    }
  } catch (err) {
    return { success: false, output: String(err) };
  }
}
