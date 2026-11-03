const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

test('sw.js, updates.js and index.html share one version', () => {
  const out = execFileSync(process.execPath, [join(__dirname, '..', 'scripts', 'version.mjs')], { encoding: 'utf8' });
  assert.match(out, /^Version \d{4}\.\d{2}\.\d{2}\.\d+/);
});
