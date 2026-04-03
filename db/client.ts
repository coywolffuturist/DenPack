import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL!);
export default sql;

export async function runMigrations(): Promise<void> {
  const { readFile } = await import('fs/promises');
  const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  await sql(schema);
  console.log('Migrations complete.');
}
