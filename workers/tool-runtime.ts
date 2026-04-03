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
        // Calls Den Chrome CDP search — stubbed; full impl in search-proxy
        return { success: false, output: 'browser_search: not yet implemented' };
      }
      case 'neon_query': {
        // Direct Neon query from Den — requires NEON_DATABASE_URL on Den
        const sql = (await import('../db/client.js')).default;
        const rows = await sql(call.query as string);
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
