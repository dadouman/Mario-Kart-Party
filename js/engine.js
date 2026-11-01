// ============================================================
// Moteurs métier purs : tirage aléatoire et calcul des points.
// Aucune dépendance au DOM ni au stockage.
// ============================================================

// ---------- Tirage ----------
// items : objets avec { id, name } ; options : { count, unique, excludeIds, lockedIds }

export function eligibleItems(allItems, { activeOnly = true, excludeIds = [], statuses }) {
  return allItems.filter((it) => {
    if (activeOnly && it.active === false) return false;
    if (it.status === 'archived') return false;
    if (excludeIds.includes(it.id)) return false;
    if (statuses && statuses.length && !statuses.includes(it.status)) return false;
    return true;
  });
}

export function drawItems(items, { count, unique = true, lockedIds = [], rng = Math.random }) {
  // lockedIds : contenus verrouillés conservés tels quels.
  const locked = items.filter((it) => lockedIds.includes(it.id));
  const pool = items.filter((it) => !lockedIds.includes(it.id));

  const need = count - locked.length;
  if (need < 0) return { error: 'locked_overflow', items: null };

  if (need === 0) return { items: [...locked] };
  if (!pool.length) return { error: 'insufficient', available: 0, items: null };

  let candidates = pool;
  if (unique) {
    // Un tirage sans doublon ne peut pas dépasser le stock d'identifiants distincts.
    const uniqueIds = new Set(candidates.map((c) => c.id));
    if (uniqueIds.size < need) {
      return {
        error: 'insufficient',
        available: uniqueIds.size,
        items: null,
      };
    }
    // Tirage sans remise (Fisher-Yates partiel), sans biais d'ordre initial.
    candidates = [...candidates];
    const picked = [];
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rng() * (candidates.length - i));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      picked.push(candidates[i]);
    }
    return { items: [...locked, ...picked] };
  }

  const picked = [];
  for (let i = 0; i < need; i++) {
    picked.push(pool[Math.floor(rng() * pool.length)]);
  }
  return { items: [...locked, ...picked] };
}

// ---------- Score ----------
// Barème : tableau de points indexé par position (index 0 = 1re place).
// Statuts : 'finished' (position), 'abandon', 'absent', 'forfait', 'disqualified'.

export const RACE_STATUSES = [
  { key: 'abandon', label: 'Abandon', pts: 0 },
  { key: 'absent', label: 'Absent', pts: 0 },
  { key: 'forfeit', label: 'Forfait', pts: 0 },
];

export function pointsFor(result, bareme) {
  if (!result) return null;
  if (result.status) {
    const st = RACE_STATUSES.find((s) => s.key === result.status);
    return st ? st.pts : 0;
  }
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

export function gpPoints(gp) {
  // Points totaux par joueur pour ce GP (validé ou provisoire).
  const totals = {};
  for (const race of gp.races) {
    for (const [pid, res] of Object.entries(race.results || {})) {
      const p = pointsFor(res, gp.bareme);
      if (p !== null) totals[pid] = (totals[pid] || 0) + p;
    }
  }
  return totals;
}

export function sessionRanking(session) {
  const totals = {};
  for (const pid of session.playerIds) totals[pid] = 0;
  for (const gp of session.grandPrix) {
    if (!gp.validated) continue;
    for (const [pid, pts] of Object.entries(gp.points)) {
      totals[pid] = (totals[pid] || 0) + pts;
    }
  }
  const rows = Object.entries(totals)
    .map(([pid, pts]) => ({ pid, pts }))
    .sort((a, b) => b.pts - a.pts);
  return rows;
}

export function allTimeStats(sessions, players) {
  // Par joueur : points, victoires (1re place en course), podiums, GPs joués.
  const stats = {};
  for (const p of players) {
    stats[p.id] = { pid: p.id, pts: 0, wins: 0, podiums: 0, gps: 0 };
  }
  for (const s of sessions) {
    for (const gp of s.grandPrix) {
      if (!gp.validated) continue;
      for (const race of gp.races) {
        for (const [pid, res] of Object.entries(race.results || {})) {
          if (!stats[pid]) stats[pid] = { pid, pts: 0, wins: 0, podiums: 0, gps: 0 };
          if (res && res.pos === 1) stats[pid].wins++;
          if (res && typeof res.pos === 'number' && res.pos <= 3) stats[pid].podiums++;
        }
      }
      for (const [pid, pts] of Object.entries(gp.points)) {
        if (!stats[pid]) stats[pid] = { pid, pts: 0, wins: 0, podiums: 0, gps: 0 };
        stats[pid].pts += pts;
        stats[pid].gps += 1;
      }
    }
  }
  return Object.values(stats).sort((a, b) => b.pts - a.pts);
}
