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

const ps = ['a', 'b', 'c'].map((id) => ({ id, name: id.toUpperCase() }));
const B = [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

test('race winners are the best real place, bots included', async () => {
  const { raceWinners } = await engine;
  assert.deepEqual(raceWinners({ results: { a: { pos: 5 }, b: { pos: 3 }, c: { pos: 9 } } }), ['b']);
  assert.deepEqual(raceWinners({ results: {} }), []);
});

test('highlights name the race king, the comeback and the tightest race', async () => {
  const { gpHighlights } = await engine;
  const gp = { bareme: B, races: [
    { contentName: 'R1', results: { a: { pos: 1 }, b: { pos: 2 }, c: { pos: 6 } } },
    { contentName: 'R2', results: { a: { pos: 7 }, b: { pos: 3 }, c: { pos: 1 } } },
    { contentName: 'R3', results: { a: { pos: 8 }, b: { pos: 4 }, c: { pos: 1 } } },
  ] };
  const facts = Object.fromEntries(gpHighlights(gp, ps).map((f) => [f.key, f.text]));
  assert.match(facts.wins, /^C · 2 courses/);
  assert.match(facts.comeback, /^C · 3e → 1er/);
  assert.match(facts.tight, /^R1 · A devant B d’une place/);
});

test('session ranking delta compares with the ranking before the GP', async () => {
  const { sessionRankingDelta } = await engine;
  const session = { playerIds: ['a', 'b'], grandPrix: [
    { id: 'g1', bareme: B, races: [{ results: { a: { pos: 1 }, b: { pos: 2 } } }] },
    { id: 'g2', bareme: B, races: [{ results: { a: { pos: 12 }, b: { pos: 1 } } }] },
  ] };
  assert.deepEqual(sessionRankingDelta(session, 'g1').map((r) => [r.pid, r.delta]), [['a', 0], ['b', 0]]);
  assert.deepEqual(sessionRankingDelta(session, 'g2').map((r) => [r.pid, r.rank, r.delta]), [['b', 1, 1], ['a', 2, -1]]);
});

test('share story tells the GP with a fun headline and the session lead', async () => {
  const { gpStory } = await engine;
  const gp1 = { id: 'g1', bareme: B, races: [
    { contentName: 'R1', results: { a: { pos: 1 }, b: { pos: 2 }, c: { pos: 6 } } },
    { contentName: 'R2', results: { a: { pos: 1 }, b: { pos: 3 }, c: { pos: 7 } } },
  ] };
  const gp2 = { id: 'g2', bareme: B, races: [
    { contentName: 'R3', results: { a: { pos: 9 }, b: { pos: 1 }, c: { pos: 2 } } },
  ] };
  const session = { playerIds: ['a', 'b', 'c'], grandPrix: [gp1, gp2] };
  const s1 = gpStory(session, gp1, ps, { url: 'https://x.test/' });
  assert.equal(s1.kicker, 'Grand chelem');
  assert.match(s1.headline, /^GP 1 : A gagne les 2 courses/);
  assert.match(s1.message, /1\. A .* · 2\. B .* · 3\. C/);
  assert.match(s1.message, /C/);
  assert.match(s1.message, /Qui relève le défi \? https:\/\/x\.test\/$/);
  assert.equal(gpStory(session, gp1, ps).message, gpStory(session, gp1, ps).message);
  const s2 = gpStory(session, gp2, ps);
  assert.match(s2.message, /Soirée après 2 GP : B prend la tête avec 37 pts, A à 3 pts derrière/);
  const tie = gpStory({ playerIds: ['a', 'b'], grandPrix: [{ id: 't', bareme: B, races: [] }] }, { id: 't', bareme: B, races: [] }, ps.slice(0, 2));
  assert.ok(tie.kicker);
});

test('GP names are fun, avoid repeats and use the evening context', async () => {
  const { gpName, gpNameContext, gpTitle, gpStory } = await engine;
  const used = [];
  for (let i = 0; i < 40; i++) {
    const n = gpName(Math.random, { used, gpNumber: i + 1, hour: 21 });
    assert.ok(!used.includes(n) && n.split(' ').length >= 2);
    used.push(n);
  }
  let x = 0; const low = () => (x++ % 2 ? 0.5 : 0.01);
  assert.match(gpName(low, { lastWinner: 'Alex', gpNumber: 2 }), / Anti-Alex$/);
  const gp1 = { id: 'g1', bareme: B, races: [{ results: { a: { pos: 1 }, b: { pos: 2 }, c: { pos: 3 } } }] };
  const session = { playerIds: ['a', 'b', 'c'], grandPrix: [gp1] };
  const ctx = gpNameContext(session, ps, null, new Date(2026, 0, 1, 23, 30));
  assert.deepEqual([ctx.gpNumber, ctx.hour, ctx.lastWinner], [2, 23, 'A']);
  assert.equal(gpTitle(session, gp1), 'Grand Prix 1');
  gp1.name = 'Coupe du Canapé';
  assert.equal(gpTitle(session, gp1), 'Coupe du Canapé');
  assert.match(gpStory(session, gp1, ps).headline, /^Coupe du Canapé : /);
});
