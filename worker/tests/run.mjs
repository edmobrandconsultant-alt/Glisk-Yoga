// Runs every test file. No dependencies, no install:  node worker/tests/run.mjs
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const here = new URL('.', import.meta.url).pathname;
const files = readdirSync(here).filter(f => f.endsWith('.test.mjs')).sort();
let failed = 0;

for (const file of files) {
  console.log(`\n─── ${file} ${'─'.repeat(Math.max(0, 56 - file.length))}`);
  const r = spawnSync(process.execPath, ['--no-warnings', here + file], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}

console.log(failed ? `\n${failed} test file(s) failed` : `\n${files.length} test files, all green`);
process.exit(failed ? 1 : 0);
