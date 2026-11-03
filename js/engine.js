// ============================================================
// Moteurs métier purs : tirage aléatoire et calcul des points.
// Aucune dépendance au DOM ni au stockage.
// ============================================================

// ---------- Tirage ----------

// Contenus tirables : actifs et non archivés.
export function eligibleItems(allItems, { excludeIds = [] } = {}) {
  const excluded = new Set(excludeIds);
  return allItems.filter((it) => it.active !== false && !it.archived &&
    it.status !== 'archived' && !excluded.has(it.id));
}

// Nombre de courses pendant lesquelles un circuit joué reste moins probable.
export const RECENT_WINDOW = 24;

// Ancienneté de chaque circuit : 0 = joué dans la toute dernière course.
export function recencyMap(sessions) {
  const races = sessions
    .flatMap((s) => s.grandPrix || [])
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .flatMap((gp) => gp.races || []);
  const age = new Map();
  races.forEach((race, index) => {
    if (race.contentId) age.set(race.contentId, races.length - 1 - index);
  });
  return age;
}

// Poids d'un circuit : 1 s'il n'a pas été joué récemment, très faible juste après.
export function drawWeight(id, recency, window = RECENT_WINDOW) {
  if (!recency || !recency.has(id)) return 1;
  const age = recency.get(id);
  if (age >= window) return 1;
  return 0.05 + 0.95 * (age / window);
}

// Tirage pondéré sans doublon (Efraimidis-Spirakis) : jamais deux fois le même
// circuit, les circuits récents sont moins probables mais restent possibles.
export function drawItems(items, { count, lockedIds = [], recency = null, rng = Math.random }) {
  const locked = new Set(lockedIds);
  const keep = items.filter((it) => locked.has(it.id));
  const seen = new Set(keep.map((it) => it.id));
  const pool = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    pool.push(it);
  }
  const need = count - keep.length;
  if (need < 0) return { error: 'locked_overflow', items: null };
  if (pool.length < need) return { error: 'insufficient', available: pool.length + keep.length, items: null };
  const picked = pool
    .map((it) => ({ it, key: Math.pow(rng() || Number.MIN_VALUE, 1 / drawWeight(it.id, recency)) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, need)
    .map((x) => x.it);
  return { items: [...keep, ...picked] };
}

// ---------- Score ----------
// Barème : tableau de points indexé par position (index 0 = 1re place).
// Les anciens statuts (abandon, absent, forfait) valent 0 point.

export function pointsFor(result, bareme) {
  if (!result) return null;
  if (result.status) return 0;
  if (typeof result.pos !== 'number') return null;
  const i = result.pos - 1;
  if (i < 0 || i >= bareme.length) return 0;
  return bareme[i];
}

export function raceComplete(race, expectedCount) {
  if (!race || !race.results) return false;
  const entries = Object.entries(race.results);
  if (expectedCount) {
    if (entries.length !== expectedCount) return false;
  } else if (entries.length === 0) {
    return false;
  }
  return entries.every(([, r]) => r && (r.status || typeof r.pos === 'number'));
}

export function gpComplete(gp, expectedCount) {
  return gp.races.every((r) => raceComplete(r, expectedCount));
}

export function gpConflicts(gp) {
  const clashes = [];
  for (const race of gp.races) {
    const counts = {};
    for (const res of Object.values(race.results || {})) {
      if (res && typeof res.pos === 'number') counts[res.pos] = (counts[res.pos] || 0) + 1;
    }
    for (const [pos, c] of Object.entries(counts)) if (c > 1) clashes.push(Number(pos));
  }
  return clashes;
}

export function gpFinished(gp, expectedCount) {
  return gp.races.length > 0 && gpComplete(gp, expectedCount) && gpConflicts(gp).length === 0;
}

// Points par joueur, calculés en direct à partir des courses saisies.
export function gpPoints(gp) {
  const totals = {};
  for (const race of gp.races) {
    for (const [pid, res] of Object.entries(race.results || {})) {
      const p = pointsFor(res, gp.bareme);
      if (p !== null) totals[pid] = (totals[pid] || 0) + p;
    }
  }
  return totals;
}

// Rang « compétition » : les ex æquo partagent le même rang (1, 1, 3…).
function withRanks(rows, key) {
  rows.forEach((row, index) => {
    row.rank = index && row[key] === rows[index - 1][key] ? rows[index - 1].rank : index + 1;
  });
  return rows;
}

export function gpStandings(gp, players) {
  const totals = gpPoints(gp);
  const rows = players.map((player, index) => ({
    player, points: totals[player.id] || 0, order: index,
  })).sort((a, b) => b.points - a.points || a.order - b.order);
  return withRanks(rows, 'points');
}

export function sessionRanking(session) {
  const totals = {};
  for (const pid of session.playerIds) totals[pid] = 0;
  for (const gp of session.grandPrix) {
    for (const [pid, pts] of Object.entries(gpPoints(gp))) {
      totals[pid] = (totals[pid] || 0) + pts;
    }
  }
  const rows = Object.entries(totals)
    .map(([pid, pts], order) => ({ pid, pts, order }))
    .sort((a, b) => b.pts - a.pts || a.order - b.order);
  return withRanks(rows, 'pts');
}

export function allTimeStats(sessions, players) {
  // Par joueur : points, victoires (1re place en course), podiums, GP joués.
  const stats = {};
  const entry = (pid) => (stats[pid] ||= { pid, pts: 0, wins: 0, podiums: 0, gps: 0 });
  for (const p of players) entry(p.id);
  for (const s of sessions) {
    for (const gp of s.grandPrix) {
      const played = new Set();
      for (const race of gp.races) {
        for (const [pid, res] of Object.entries(race.results || {})) {
          if (!res) continue;
          played.add(pid);
          if (res.pos === 1) entry(pid).wins++;
          if (typeof res.pos === 'number' && res.pos <= 3) entry(pid).podiums++;
        }
      }
      for (const [pid, pts] of Object.entries(gpPoints(gp))) entry(pid).pts += pts;
      for (const pid of played) entry(pid).gps++;
    }
  }
  const rows = Object.values(stats).sort((a, b) => b.pts - a.pts);
  return withRanks(rows, 'pts');
}

// ---------- Récap de fin de Grand Prix ----------

// Joueur(s) le(s) mieux placé(s) d'une course (place réelle la plus basse).
export function raceWinners(race) {
  const entries = Object.entries(race.results || {}).filter(([, r]) => r && typeof r.pos === 'number');
  if (!entries.length) return [];
  const best = Math.min(...entries.map(([, r]) => r.pos));
  return entries.filter(([, r]) => r.pos === best).map(([pid]) => pid);
}

// Classement de la soirée avant/après un GP, avec la variation de rang.
export function sessionRankingDelta(session, gpId) {
  const index = session.grandPrix.findIndex((g) => g.id === gpId);
  const upTo = (n) => sessionRanking({ ...session, grandPrix: session.grandPrix.slice(0, n) });
  const before = Object.fromEntries(upTo(index).map((r) => [r.pid, r.rank]));
  const firstGp = index <= 0;
  return upTo(index + 1).map((row) => ({ ...row, delta: firstGp ? 0 : before[row.pid] - row.rank }));
}

// Faits marquants : victoires, meilleure remontée, course la plus serrée.
export function gpHighlights(gp, players) {
  const name = (pid) => players.find((p) => p.id === pid)?.name || '?';
  const facts = [];
  const races = gp.races.filter((r) => Object.keys(r.results || {}).length);
  if (!races.length || !players.length) return facts;

  const wins = {};
  races.forEach((r) => raceWinners(r).forEach((pid) => { wins[pid] = (wins[pid] || 0) + 1; }));
  const maxWins = Math.max(0, ...Object.values(wins));
  if (maxWins > 0) {
    const kings = Object.keys(wins).filter((pid) => wins[pid] === maxWins);
    facts.push({ key: 'wins', title: 'Roi des courses',
      text: kings.map(name).join(' et ') + ' · ' + maxWins + ' course' + (maxWins > 1 ? 's' : '') + ' remportée' + (maxWins > 1 ? 's' : '') });
  }

  if (races.length > 1) {
    const afterFirst = Object.fromEntries(gpStandings({ ...gp, races: races.slice(0, 1) }, players).map((r) => [r.player.id, r.rank]));
    const final = gpStandings(gp, players);
    let best = null;
    final.forEach((r) => {
      const gain = afterFirst[r.player.id] - r.rank;
      if (gain > 0 && (!best || gain > best.gain)) best = { pid: r.player.id, gain, from: afterFirst[r.player.id], to: r.rank };
    });
    if (best) facts.push({ key: 'comeback', title: 'Meilleure remontée',
      text: name(best.pid) + ' · ' + ordinal(best.from) + ' → ' + ordinal(best.to) });
  }

  if (players.length > 1) {
    let tight = null;
    races.forEach((r) => {
      const ranked = Object.entries(r.results).filter(([, x]) => typeof x?.pos === 'number').sort((a, b) => a[1].pos - b[1].pos);
      if (ranked.length < 2) return;
      const gap = ranked[1][1].pos - ranked[0][1].pos;
      if (!tight || gap < tight.gap) tight = { race: r, gap, a: ranked[0][0], b: ranked[1][0] };
    });
    if (tight) facts.push({ key: 'tight', title: 'Course la plus serrée',
      text: tight.race.contentName + ' · ' + name(tight.a) + ' devant ' + name(tight.b) +
        (tight.gap <= 1 ? ' d’une place' : ' de ' + tight.gap + ' places') });
  }
  return facts;
}

export const ordinal = (n) => n + (n === 1 ? 'er' : 'e');
