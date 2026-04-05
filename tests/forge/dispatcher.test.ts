import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('dispatcher forge registration', () => {
  const src = readFileSync('coordinator/dispatcher.ts', 'utf8');

  it('forge is mentioned in dispatcher', () => {
    expect(src).toMatch(/forge/i);
  });

  it('forge is not in any routable domain array', () => {
    // forge should appear in comments/registry but NOT as a routable agent value in DOMAIN_AGENT_MAP
    // The map values are arrays of agent names like ['lumen', 'vex']
    // forge should never appear as a quoted string in those arrays
    const mapSection = src.match(/DOMAIN_AGENT_MAP[\s\S]+?};/)?.[0] ?? '';
    expect(mapSection).not.toMatch(/['"]forge['"]/);
  });
});
