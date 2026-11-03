const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(require('node:path').join(__dirname, '..', 'js', 'app.js'), 'utf8')
  .split('// ---------- Thème')[0].replace(/^import .*;\n/gm, '');

function route(hash) {
  let result;
  const sandbox = {
    location: { hash }, console,
    window: { addEventListener() {} },
    document: { querySelectorAll: () => [] },
    getState: () => ({ settings: { appName: 'Mario Kart Party' } }),
    render: view => { result = view; },
  };
  for (const name of ['HomeView', 'NewSessionView', 'SessionView', 'GpView',
    'RaceView', 'NotFound', 'TirageView', 'GameView',
    'ClassementView', 'ReglagesView']) {
    sandbox[name] = (...args) => ({ name, args: JSON.parse(JSON.stringify(args)) });
  }
  vm.runInNewContext(source, sandbox);
  return result;
}

test('old GP preparation links open the evening; express draw stays reachable', () => {
  assert.deepEqual(route('#/session/session-2/nouveau-gp'),
    { name: 'SessionView', args: ['session-2'] });
  assert.deepEqual(route('#/tirage'), { name: 'TirageView', args: [] });
});

test('the game library now lives in settings', () => {
  assert.deepEqual(route('#/jeux'), { name: 'ReglagesView', args: [] });
});

test('catalog import has a dedicated address without changing game detail', () => {
  assert.deepEqual(route('#/jeux/game-1/import'),
    { name: 'GameView', args: ['game-1', { importing: true }] });
  assert.deepEqual(route('#/jeux/game-1'),
    { name: 'GameView', args: ['game-1'] });
});

test('existing GP and individual course links remain compatible', () => {
  assert.deepEqual(route('#/session/s1/gp/gp1'), { name: 'GpView', args: ['s1', 'gp1'] });
  assert.deepEqual(route('#/session/s1/gp/gp1/course/3'),
    { name: 'RaceView', args: ['s1', 'gp1', 3] });
});
