// Sans dépendance : node --test tests/engine.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const source = readFileSync(require('node:path').join(__dirname, '..', 'js', 'engine.js'), 'utf8');
const engine = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const courses = (n) => Array.from({ length: n }, (_, i) => ({ id: 'c' + i, name: 'Circuit ' + i }));

test('a draw never repeats a course and keeps locked courses', async () => {
  const { drawItems } = await engine;
  for (let i = 0; i < 200; i++) {
    const { items } = drawItems(courses(6), { count: 6, lockedIds: ['c2'] });
    assert.equal(new Set(items.map((c) => c.id)).size, 6);
    assert.equal(items[0].id, 'c2');
  }
  assert.equal(drawItems(courses(3), { count: 4 }).error, 'insufficient');
});

test('recently played courses become less likely without being forbidden', async () => {
  const { drawItems, recencyMap } = await engine;
  const sessions = [{ grandPrix: [{ createdAt: 1, races: [{ contentId: 'c0' }] }] }];
  const recency = recencyMap(sessions);
  assert.equal(recency.get('c0'), 0);
  let recent = 0;
  for (let i = 0; i < 4000; i++) {
    if (drawItems(courses(2), { count: 1, recency }).items[0].id === 'c0') recent++;
  }
  assert.ok(recent > 0 && recent < 400, 'tirages du circuit récent : ' + recent);
});

test('inactive and archived courses are never drawn', async () => {
  const { eligibleItems } = await engine;
  const pool = [{ id: 'a' }, { id: 'b', active: false }, { id: 'c', archived: true }, { id: 'd', status: 'archived' }];
  assert.deepEqual(eligibleItems(pool).map((c) => c.id), ['a']);
});

test('evening ranking counts live results and shares ranks on ties', async () => {
  const { sessionRanking } = await engine;
  const bareme = [15, 12, 10];
  const session = {
    playerIds: ['a', 'b', 'c'],
    grandPrix: [{ bareme, races: [
      { results: { a: { pos: 1 }, b: { pos: 2 } } },
      { results: { a: { pos: 2 }, b: { pos: 1 }, c: { pos: 3 } } },
    ] }],
  };
  assert.deepEqual(sessionRanking(session).map((r) => [r.pid, r.pts, r.rank]),
    [['a', 27, 1], ['b', 27, 1], ['c', 10, 3]]);
});

test('old special statuses still count as 0 point and complete the race', async () => {
  const { pointsFor, raceComplete } = await engine;
  assert.equal(pointsFor({ status: 'forfeit' }, [15]), 0);
  assert.ok(raceComplete({ results: { a: { pos: 1 }, b: { status: 'abandon' } } }, 2));
});
