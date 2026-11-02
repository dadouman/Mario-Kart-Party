const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const source = readFileSync(require('node:path').join(__dirname, '..', 'js', 'engine.js'), 'utf8');
const engine = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const players = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id }));
const gp = (races) => ({ bareme: [15, 12, 10, 9, 8, 7, 6, 5], races });

test('everyone starts at zero with a shared first rank, in participant order', async () => {
  const { gpStandings } = await engine;
  assert.deepEqual(gpStandings(gp([{ results: {} }]), players).map((r) => [r.player.id, r.points, r.rank]),
    [['a', 0, 1], ['b', 0, 1], ['c', 0, 1], ['d', 0, 1]]);
});
test('live results reorder standings, include bots positions and absent players', async () => {
  const { gpStandings } = await engine;
  const rows = gpStandings(gp([{ results: { a: { pos: 8 }, b: { pos: 1 }, c: { status: 'abandon' } } }]), players);
  assert.deepEqual(rows.map((r) => [r.player.id, r.points, r.rank]),
    [['b', 15, 1], ['a', 5, 2], ['c', 0, 3], ['d', 0, 3]]);
});
test('ties keep shared competition rank without mutating players or scores', async () => {
  const { gpStandings } = await engine;
  const data = gp([{ results: { a: { pos: 1 }, b: { pos: 2 }, c: { pos: 3 }, d: { pos: 4 } } },
    { results: { a: { pos: 2 }, b: { pos: 1 }, c: { pos: 4 }, d: { pos: 3 } } }]);
  const before = JSON.stringify({ data, players });
  assert.deepEqual(gpStandings(data, players).map((r) => [r.player.id, r.points, r.rank]),
    [['a', 27, 1], ['b', 27, 1], ['c', 19, 3], ['d', 19, 3]]);
  assert.equal(JSON.stringify({ data, players }), before);
});
test('one or two players and positions outside the points scale are supported', async () => {
  const { gpStandings } = await engine;
  assert.equal(gpStandings(gp([]), players.slice(0, 1)).length, 1);
  assert.deepEqual(gpStandings(gp([{ results: { a: { pos: 24 }, b: { pos: 8 } } }]), players.slice(0, 2))
    .map((r) => [r.player.id, r.points, r.rank]), [['b', 5, 1], ['a', 0, 2]]);
});
