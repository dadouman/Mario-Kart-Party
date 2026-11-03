// Repères visuels partagés : le nom reste explicite, la couleur est un complément.
import { h } from './ui.js';
import { findGame } from './store.js';

export function raceGame(item, gp = {}) {
  const saved = findGame(item.gameId || gp.gameId);
  return {
    id: item.gameId || gp.gameId || item.gameName || gp.gameName || 'unknown',
    name: item.gameName || saved?.name || gp.gameName || 'Jeu non renseigné',
  };
}

export function gameStyle(game) {
  const name = game.name.toLowerCase();
  let accent;
  if (name.includes('mario kart') && name.includes('world')) accent = '#23b8d1';
  else if (name.includes('mario kart') && name.includes('8')) accent = '#d875e8';
  else {
    const colors = ['#e7a840', '#57ba86', '#809cf0', '#e78274', '#69bcb3'];
    const hash = [...name].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0);
    accent = colors[hash % colors.length];
  }
  return '--game-accent:' + accent;
}

export function gameBadge(game) {
  return h('span', { class: 'game-identity', style: gameStyle(game) },
    h('span', { class: 'game-identity-dot', 'aria-hidden': 'true' }),
    h('span', {}, game.name));
}

export function gameLegend(items, gp = {}) {
  const games = new Map();
  items.forEach((item) => {
    const game = raceGame(item, gp);
    const entry = games.get(game.id) || { game, count: 0 };
    entry.count++;
    games.set(game.id, entry);
  });
  return h('div', { class: 'game-legend', 'aria-label': 'Jeux dans ce Grand Prix' },
    [...games.values()].map(({ game, count }) =>
      h('div', { class: 'game-legend-item', style: gameStyle(game) },
        gameBadge(game), h('span', { class: 'sub' }, count + (count > 1 ? ' courses' : ' course')))));
}

export function timelineStep({ index, game, previousGame, card, state = '', label = '' }) {
  const switched = previousGame && previousGame.id !== game.id;
  return h('li', { class: 'timeline-step ' + state, style: gameStyle(game) },
    switched ? h('div', { class: 'timeline-switch' },
      h('span', { 'aria-hidden': 'true' }, '↳'), ' Changement de jeu') : null,
    h('div', { class: 'timeline-row' },
      h('span', { class: 'timeline-node', 'aria-label': 'Course ' + (index + 1) }, String(index + 1).padStart(2, '0')),
      h('div', { class: 'timeline-content' },
        label ? h('div', { class: 'timeline-label' }, label) : null,
        card)));
}

// Nom court affiché sur la pastille du jeu.
export function gameShort(game) {
  if (/mario kart.*8/i.test(game.name)) return 'MK8';
  if (/mario kart.*world/i.test(game.name)) return 'World';
  return game.name.split(/\s+/).map((word) => word[0]).slice(0, 4).join('').toUpperCase();
}

export function gamePill(game) {
  return h('span', { class: 'game-pill', style: gameStyle(game), title: game.name }, gameShort(game));
}

// Nombre de pilotes d'une course : réglage du jeu, sinon 24 pour World, 12 ailleurs.
export function racersFor(game) {
  const saved = game && findGame(game.id);
  if (saved?.racers) return saved.racers;
  return /world/i.test(game?.name || '') ? 24 : 12;
}

// Icônes SVG partagées (décoratives).
export const ICONS = {
  kart: '<svg viewBox="0 0 32 40"><rect x="2" y="6" width="7" height="10" rx="2" class="k-wheel"/><rect x="23" y="6" width="7" height="10" rx="2" class="k-wheel"/><rect x="2" y="25" width="7" height="10" rx="2" class="k-wheel"/><rect x="23" y="25" width="7" height="10" rx="2" class="k-wheel"/><path d="M8 4h16l3 10v14l-4 9H9l-4-9V14z" class="k-body"/><circle cx="16" cy="17" r="5.5" class="k-helmet"/><rect x="10" y="30" width="12" height="3" rx="1.5" class="k-bumper"/></svg>',
  reroll: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
};
export const icon = (name) => h('span', { class: 'gp-icon', 'aria-hidden': 'true', html: ICONS[name] });

// Bouton « changer de circuit » (icône de relance).
export function rerollButton(onClick, testid) {
  return h('button', {
    class: 'gp-reroll', 'aria-label': 'Changer de circuit', title: 'Changer de circuit',
    'data-testid': testid, onclick: onClick,
  }, icon('reroll'));
}
