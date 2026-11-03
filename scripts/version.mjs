#!/usr/bin/env node
// Numéro de version unique : `node scripts/version.mjs 2026.11.03.1`
// met à jour sw.js, js/updates.js et les paramètres ?v= de index.html.
// Sans argument, affiche la version courante et vérifie la cohérence.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = {
  'sw.js': [/const VERSION = '([^']+)'/, (v) => `const VERSION = '${v}'`],
  'js/updates.js': [/export const APP_VERSION = '([^']+)'/, (v) => `export const APP_VERSION = '${v}'`],
  'index.html': [/\?v=([0-9.]+)/g, (v) => `?v=${v}`],
};

const next = process.argv[2];
if (next && !/^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(next)) {
  console.error('Format attendu : AAAA.MM.JJ.N');
  process.exit(1);
}
const found = new Set();
for (const [file, [pattern, replacement]] of Object.entries(files)) {
  const path = join(root, file);
  let text = readFileSync(path, 'utf8');
  for (const m of text.matchAll(new RegExp(pattern.source, 'g'))) found.add(m[1]);
  if (next) {
    text = text.replace(pattern, () => replacement(next));
    writeFileSync(path, text);
  }
}
if (next) console.log('Version ' + next);
else if (found.size === 1) console.log('Version ' + [...found][0]);
else { console.error('Versions incohérentes : ' + [...found].join(', ')); process.exit(1); }
