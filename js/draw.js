// ============================================================
// Tirage partagé : préférences mémorisées, sélection des jeux et
// création directe d'un Grand Prix. Pas d'options à régler :
// jamais de doublon, circuits récents automatiquement moins probables.
// ============================================================

import { activeGames, gameContents, newId, save, getPlayers } from './store.js';
import { h, toast } from './ui.js';
import { drawItems, eligibleItems, recencyMap, gpName, gpNameContext } from './engine.js';
import { gameBadge } from './race-visuals.js';

const COUNT_PRESETS = [2, 4, 6, 8];

// Préférences normalisées : { gameIds, editionIds: { gameId: [ids] }, count }.
export function getDrawPrefs(st) {
  const games = activeGames();
  const raw = st.settings.drawPreferences || {};
  const remembered = (raw.gameIds || []).filter((id) => games.some((g) => g.id === id));
  const editionIds = {};
  for (const g of games) {
    const saved = raw.editionIds && Array.isArray(raw.editionIds[g.id]) ? raw.editionIds[g.id] : null;
    editionIds[g.id] = (saved || g.editions.filter((e) => e.active !== false).map((e) => e.id))
      .filter((id) => g.editions.some((e) => e.id === id));
  }
  return {
    gameIds: remembered.length ? remembered : games.map((g) => g.id),
    editionIds,
    count: Math.max(1, Math.min(24, Number(raw.count) || 4)),
  };
}

export function setDrawPrefs(st, prefs) {
  st.settings.drawPreferences = {
    gameIds: [...prefs.gameIds], editionIds: { ...prefs.editionIds }, count: prefs.count,
  };
  save();
}

export function drawPool(prefs) {
  return activeGames()
    .filter((g) => prefs.gameIds.includes(g.id))
    .flatMap((g) => eligibleItems(gameContents(g, prefs.editionIds[g.id] || [])));
}

// Tire `count` circuits (ou le nombre mémorisé), sans doublon, pondéré par l'historique.
export function drawCourses(st, prefs, { count = prefs.count, lockedItems = [], excludeIds = [] } = {}) {
  const exclude = new Set(excludeIds);
  const pool = drawPool(prefs).filter((c) => !exclude.has(c.id));
  const lockedIds = lockedItems.map((c) => c.id);
  const res = drawItems([...lockedItems, ...pool], {
    count, lockedIds, recency: recencyMap(st.sessions),
  });
  return res;
}

// Construit un objet Grand Prix à partir de circuits tirés (un ou plusieurs jeux).
export function buildGpFromItems(st, items) {
  const gameIds = [...new Set(items.map((c) => c.gameId).filter(Boolean))];
  let gameName = 'Multi-jeux';
  let gameIcon = '🎮';
  let gameId = 'multi';
  if (gameIds.length === 1) {
    const g = st.games.find((x) => x.id === gameIds[0]);
    if (g) { gameName = g.name; gameIcon = g.icon; gameId = g.id; }
  }
  return {
    id: newId('gp'),
    gameId, gameName, gameIcon,
    multiGame: gameIds.length > 1,
    editionNames: [...new Set(items.map((c) => c.editionName).filter(Boolean))],
    bareme: st.settings.bareme.slice(),
    createdAt: Date.now(),
    races: items.map((c, i) => ({
      id: newId('r'), num: i + 1, contentId: c.id, contentName: c.name,
      editionName: c.editionName, results: {},
      gameId: c.gameId || null, gameName: c.gameName || null, gameIcon: c.gameIcon || null,
    })),
  };
}

// Ajoute directement un Grand Prix tiré au sort à la soirée. Renvoie le GP ou null.
export function startGrandPrix(st, session) {
  const res = drawCourses(st, getDrawPrefs(st));
  if (res.error) {
    toast('Pas assez de circuits disponibles : ajoutez des jeux ou des éditions, ou réduisez le nombre de courses.', 'err');
    return null;
  }
  const gp = buildGpFromItems(st, res.items);
  gp.name = gpName(Math.random, gpNameContext(session, getPlayers(session.playerIds)));
  session.grandPrix.push(gp);
  save();
  return gp;
}

// Tire un autre nom pour un GP existant.
export function renameGp(session, gp) {
  gp.name = gpName(Math.random, gpNameContext(session, getPlayers(session.playerIds), gp));
  save();
  return gp.name;
}

// Remplace un circuit pas encore joué d'un GP par un autre, selon les préférences.
export function replaceRace(st, gp, race) {
  const res = drawCourses(st, getDrawPrefs(st), {
    count: 1, excludeIds: gp.races.map((r) => r.contentId),
  });
  if (res.error) { toast('Aucun autre circuit disponible avec ces jeux', 'err'); return false; }
  const c = res.items[0];
  Object.assign(race, {
    contentId: c.id, contentName: c.name, editionName: c.editionName,
    gameId: c.gameId || null, gameName: c.gameName || null, gameIcon: c.gameIcon || null,
  });
  gp.editionNames = [...new Set(gp.races.map((r) => r.editionName).filter(Boolean))];
  const gameIds = new Set(gp.races.map((r) => r.gameId).filter(Boolean));
  gp.multiGame = gameIds.size > 1;
  save();
  return true;
}

// Éditeur compact : jeux, nombre de courses, éditions/DLC repliées.
export function DrawPrefsEditor(st, { onChange, collapsed = false } = {}) {
  const games = activeGames();
  const prefs = getDrawPrefs(st);
  const summary = h('span', { class: 'sub draw-config-summary' });
  const gamesBox = h('div', { class: 'draw-games' });
  const editionsBox = h('div', { class: 'stack' });
  const countBox = h('div', { class: 'draw-count-presets', role: 'group', 'aria-label': 'Nombre de courses' });
  const info = h('p', { class: 'sub', role: 'status', 'aria-live': 'polite' });
  const countInput = h('input', {
    class: 'input draw-count-input', type: 'number', min: '1', max: '24', step: '1', inputmode: 'numeric',
    'data-testid': 'input-race-count', 'aria-label': 'Nombre de courses (1 à 24)', title: 'Autre nombre (1 à 24)',
  });
  countInput.addEventListener('change', () => {
    const n = Math.round(Number(countInput.value));
    if (countInput.value === '') { refresh(); return; }
    if (!n || n < 1 || n > 24) { toast('Entre 1 et 24 courses', 'err'); refresh(); return; }
    prefs.count = n;
    changed();
  });
  countInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') countInput.blur(); });

  function changed() {
    setDrawPrefs(st, prefs);
    refresh();
    onChange?.(prefs);
  }

  function refresh() {
    const available = drawPool(prefs).length;
    summary.textContent = prefs.count + ' courses · ' +
      games.filter((g) => prefs.gameIds.includes(g.id)).map((g) => g.name).join(' + ');
    info.textContent = available < prefs.count
      ? 'Seulement ' + available + ' circuits disponibles pour ' + prefs.count + ' courses.'
      : available + ' circuits disponibles';
    info.classList.toggle('is-error', available < prefs.count);

    gamesBox.replaceChildren(...games.map((g) => {
      const cb = h('input', { type: 'checkbox', checked: prefs.gameIds.includes(g.id) });
      cb.addEventListener('change', () => {
        if (cb.checked) prefs.gameIds.push(g.id);
        else if (prefs.gameIds.length > 1) prefs.gameIds = prefs.gameIds.filter((id) => id !== g.id);
        else { cb.checked = true; toast('Gardez au moins un jeu'); return; }
        changed();
      });
      const n = eligibleItems(gameContents(g, prefs.editionIds[g.id] || [])).length;
      return h('label', { class: 'draw-game' + (cb.checked ? ' selected' : '') }, cb,
        h('span', { class: 'content-name' }, gameBadge({ id: g.id, name: g.name })),
        h('span', { class: 'sub' }, n + ' circuits'));
    }));

    countBox.replaceChildren(...COUNT_PRESETS.map((n) => h('button', {
      class: 'btn btn-sm ' + (n === prefs.count ? 'btn-primary' : 'btn-outline'),
      'aria-pressed': String(n === prefs.count), 'data-testid': 'count-' + n,
      onclick: () => { prefs.count = n; changed(); },
    }, String(n))), countInput);
    countInput.value = COUNT_PRESETS.includes(prefs.count) ? '' : prefs.count;
    countInput.placeholder = 'Autre';
    countInput.classList.toggle('is-custom', !COUNT_PRESETS.includes(prefs.count));

    editionsBox.replaceChildren(...games.filter((g) => prefs.gameIds.includes(g.id)).map((g) =>
      h('div', { class: 'stack', style: 'gap:6px' },
        h('span', { class: 'field-label' }, g.name),
        g.editions.map((ed) => {
          const cb = h('input', { type: 'checkbox', checked: (prefs.editionIds[g.id] || []).includes(ed.id) });
          cb.addEventListener('change', () => {
            const set = new Set(prefs.editionIds[g.id] || []);
            if (cb.checked) set.add(ed.id); else set.delete(ed.id);
            prefs.editionIds[g.id] = [...set];
            changed();
          });
          return h('label', { class: 'content-row', style: 'cursor:pointer' }, cb,
            h('span', { class: 'content-name' }, ed.name + (ed.dlc ? ' (DLC)' : '')),
            h('span', { class: 'badge' }, eligibleItems(ed.contents).length));
        }))));
  }
  refresh();

  const body = h('div', { class: 'stack' },
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Jeux'), gamesBox),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Courses par Grand Prix'), countBox),
    h('details', { class: 'draw-options' },
      h('summary', {}, 'Éditions et DLC'), editionsBox),
    info);

  if (!collapsed) return body;
  return h('details', { class: 'card draw-prefs' },
    h('summary', { class: 'spread' }, h('strong', {}, 'Jeux et courses'), summary), body);
}
