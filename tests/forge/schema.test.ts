import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('forge schema', () => {
  const schema = readFileSync('db/schema.sql', 'utf8');

  it('contains pack_forge_reviews table', () => {
    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS pack_forge_reviews/);
  });

  it('contains required columns in pack_forge_reviews', () => {
    expect(schema).toMatch(/verdict\s+TEXT/);
    expect(schema).toMatch(/test_outcome\s+TEXT/);
    expect(schema).toMatch(/label\s+TEXT/);
    expect(schema).toMatch(/f1_rolling\s+FLOAT/);
  });

  it('contains pack_forge_checklist_proposals table', () => {
    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS pack_forge_checklist_proposals/);
  });
});
