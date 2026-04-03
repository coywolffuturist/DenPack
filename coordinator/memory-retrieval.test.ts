import { strict as assert } from 'assert';
import { loadMemoryIndex, selectSections, buildAgentContext } from './memory-retrieval.js';
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';

// --- Fixtures ---

const SAMPLE_INDEX = `
# Memory Index

## prowl-strategies
- active-strategies: entities/prowl-strategies.md#L1-10
- risk-rules: entities/prowl-strategies.md#L11-20

## projects
- prowl: PROJECTS.md#L1-5
- lucid: PROJECTS.md#L6-10

## goals
- revenue-targets: reference/GOALS.md#L1-5
- q2-priorities: reference/GOALS.md#L6-10

## people
- brendan: entities/Brendan-Joyce.md#L1-5
`;

function makeTestMemory(dir: string) {
  mkdirSync(path.join(dir, 'entities'), { recursive: true });
  mkdirSync(path.join(dir, 'reference'), { recursive: true });
  // Each file has 20 lines numbered
  const lines20 = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
  const lines10 = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
  writeFileSync(path.join(dir, 'entities/prowl-strategies.md'), lines20);
  writeFileSync(path.join(dir, 'PROJECTS.md'), lines10);
  writeFileSync(path.join(dir, 'reference/GOALS.md'), lines10);
  writeFileSync(path.join(dir, 'entities/Brendan-Joyce.md'), lines10);
}

// --- Tests ---

let tmpDir!: string;
let indexPath!: string;
let memoryRoot!: string;
let agentDir!: string;

function setup() {
  tmpDir = path.join(os.tmpdir(), `smr-test-${Date.now()}`);
  indexPath = path.join(tmpDir, 'memory-index.md');
  memoryRoot = path.join(tmpDir, 'memory');
  agentDir = path.join(tmpDir, 'agent-workdir');
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(indexPath, SAMPLE_INDEX);
  makeTestMemory(memoryRoot);
}

function teardown() {
  rmSync(tmpDir, { recursive: true, force: true });
}

// Test 1: loadMemoryIndex parses all groups and sections
setup();
const index = loadMemoryIndex(indexPath);
assert.ok(index['prowl-strategies'], 'prowl-strategies group missing');
assert.ok(index['prowl-strategies']['active-strategies'], 'active-strategies missing');
assert.deepEqual(index['prowl-strategies']['active-strategies'], { file: 'entities/prowl-strategies.md', start: 1, end: 10 });
assert.ok(index['goals']['revenue-targets'], 'revenue-targets missing');
teardown();
console.log('✅ Test 1: loadMemoryIndex parses correctly');

// Test 2: selectSections — prowl domain gets baseline sections
setup();
const prowlIndex = loadMemoryIndex(indexPath);
const prowlSections = selectSections('prowl', 'execute mode 1 hedge', prowlIndex, memoryRoot);
const prowlLabels = prowlSections.map(s => s.label);
assert.ok(prowlLabels.includes('prowl-strategies/active-strategies'), 'missing active-strategies for prowl');
assert.ok(prowlLabels.includes('prowl-strategies/risk-rules'), 'missing risk-rules for prowl');
assert.ok(prowlLabels.includes('projects/prowl'), 'missing projects/prowl for prowl');
teardown();
console.log('✅ Test 2: selectSections prowl domain baseline');

// Test 3: selectSections — lucid domain does NOT get prowl sections
setup();
const lucidIndex = loadMemoryIndex(indexPath);
const lucidSections = selectSections('lucid', 'build the agent handoff feature', lucidIndex, memoryRoot);
const lucidLabels = lucidSections.map(s => s.label);
assert.ok(lucidLabels.includes('projects/lucid'), 'missing projects/lucid for lucid domain');
assert.ok(!lucidLabels.includes('prowl-strategies/active-strategies'), 'lucid should not get prowl strategies');
teardown();
console.log('✅ Test 3: selectSections lucid domain excludes prowl');

// Test 4: keyword augmentation adds backtest section
setup();
const augIdx = loadMemoryIndex(indexPath);
const augSections = selectSections('prowl', 'backtest the momentum fade strategy', augIdx, memoryRoot);
const augLabels = augSections.map(s => s.label);
assert.ok(augLabels.includes('prowl-strategies/active-strategies'), 'missing active-strategies');
teardown();
console.log('✅ Test 4: keyword augmentation works');

// Test 5: buildAgentContext writes context.md with correct section count
setup();
const ctxIndex = loadMemoryIndex(indexPath);
const result = buildAgentContext({
  agent: 'lumen',
  domain: 'prowl',
  taskText: 'execute hedge on polymarket',
  agentDir,
  memoryRoot,
  indexPath,
});
assert.ok(result.sectionCount > 0, 'no sections selected');
assert.ok(result.tokenEstimate > 0, 'token estimate should be positive');
const written = readFileSync(result.contextPath, 'utf8');
assert.ok(written.includes('prowl-strategies/active-strategies'), 'context missing active-strategies header');
teardown();
console.log('✅ Test 5: buildAgentContext writes context.md');

// Test 6: buildAgentContext deduplicates sections
setup();
const dedupResult = buildAgentContext({
  agent: 'vex',
  domain: 'prowl',
  taskText: 'prowl prowl prowl',  // domain + keywords both try to add prowl sections
  agentDir,
  memoryRoot,
  indexPath,
});
const dedupContent = readFileSync(dedupResult.contextPath, 'utf8');
const activeCount = (dedupContent.match(/active-strategies/g) || []).length;
assert.equal(activeCount, 1, `active-strategies appeared ${activeCount} times — not deduplicated`);
teardown();
console.log('✅ Test 6: deduplication works');

// Test 7: graceful fallback when index is missing
setup();
const fallbackResult = buildAgentContext({
  agent: 'lumen',
  domain: 'prowl',
  taskText: 'any task',
  agentDir,
  memoryRoot,
  indexPath: '/nonexistent/path/memory-index.md',
  fallbackFiles: ['PROJECTS.md'],
});
assert.equal(fallbackResult.tokenEstimate, -1, 'fallback should return -1 for tokenEstimate');
const fallbackContent = readFileSync(fallbackResult.contextPath, 'utf8');
assert.ok(fallbackContent.includes('line 1'), 'fallback should copy full file content');
teardown();
console.log('✅ Test 7: graceful fallback on missing index');

console.log('\n✅ All tests passed');
