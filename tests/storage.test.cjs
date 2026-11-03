const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(require('node:path').join(__dirname, '..', 'js', 'store.js'), 'utf8')
  .replace(/\bexport /g, '');

function tab(storage) {
  const events = [];
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  const sandbox = {
    localStorage, window: { localStorage, dispatchEvent: (event) => events.push(event.type) },
    CustomEvent: class { constructor(type) { this.type = type; } },
    console, setTimeout: () => 1, clearTimeout() {},
  };
  vm.runInNewContext(source + '\nglobalThis.api = {getState, save, flushSave, previousBackup};', sandbox);
  return { ...sandbox.api, events };
}
const initial = () => JSON.stringify({ version: 1, games: [], players: [], sessions: [], settings: {} });

test('an unchanged stale tab never overwrites newer data during a PWA update', () => {
  const storage = new Map([['mkp-data', initial()]]);
  const current = tab(storage), stale = tab(storage);
  current.getState().sessions.push({ id: 'new-session' });
  current.save();
  assert.equal(current.flushSave(), true);
  const latest = storage.get('mkp-data');
  assert.equal(stale.flushSave(), true);
  assert.equal(storage.get('mkp-data'), latest);
});

test('a modified stale tab is blocked, preserves its draft and warns once', () => {
  const storage = new Map([['mkp-data', initial()]]);
  const current = tab(storage), stale = tab(storage);
  current.getState().sessions.push({ id: 'new-session' });
  current.save(); current.flushSave();
  const latest = storage.get('mkp-data');
  stale.getState().sessions.push({ id: 'stale-draft' });
  stale.save();
  assert.equal(stale.flushSave(), false);
  assert.equal(stale.flushSave(), false);
  assert.equal(storage.get('mkp-data'), latest);
  assert.equal(stale.getState().sessions[0].id, 'stale-draft');
  assert.deepEqual(stale.events, ['mkp-storage-conflict']);
});

test('successful writes retain the previous JSON snapshot and can save repeatedly', () => {
  const old = initial(), storage = new Map([['mkp-data', old]]);
  const current = tab(storage);
  current.getState().sessions.push({ id: 'first' });
  current.save(); current.flushSave();
  assert.equal(current.previousBackup(), old);
  const first = storage.get('mkp-data');
  current.getState().sessions.push({ id: 'second' });
  current.save();
  assert.equal(current.flushSave(), true);
  assert.equal(current.previousBackup(), first);
  assert.equal(JSON.parse(storage.get('mkp-data')).sessions.length, 2);
});

test('v1 data migrates to the essential model without losing results', () => {
  const v1 = {
    version: 1, players: [], settings: { drawPreferences: { unique: true, excludeRecent: true, count: 4 } },
    draws: [{ contentIds: ['c1'] }],
    games: [{ id: 'g', name: 'MK', platform: 'Switch', genre: 'Course', contentType: 'Circuit',
      editions: [{ id: 'e', contents: [
        { id: 'c1', name: 'A', status: 'unverified', source: 'wiki', tags: [], active: true },
        { id: 'c2', name: 'B', status: 'archived', active: true },
      ] }] }],
    sessions: [{ id: 's', status: 'closed', draws: [], playerIds: ['p'], grandPrix: [{
      id: 'gp', validated: true, points: { p: 15 }, history: [{}], races: [{ results: { p: { pos: 1 } } }],
    }] }],
  };
  const storage = new Map([['mkp-data', JSON.stringify(v1)]]);
  const st = JSON.parse(JSON.stringify(tab(storage).getState()));
  assert.equal(st.version, 2);
  assert.equal(st.draws, undefined);
  assert.deepEqual(st.settings.drawPreferences, { count: 4 });
  assert.deepEqual(Object.keys(st.games[0]).sort(), ['editions', 'id', 'name']);
  assert.deepEqual(st.games[0].editions[0].contents[0], { id: 'c1', name: 'A', active: true });
  assert.equal(st.games[0].editions[0].contents[1].archived, true);
  assert.deepEqual(Object.keys(st.sessions[0]).sort(), ['grandPrix', 'id', 'playerIds']);
  assert.deepEqual(st.sessions[0].grandPrix[0].races[0].results, { p: { pos: 1 } });
  assert.equal(st.sessions[0].grandPrix[0].validated, undefined);
});
