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
