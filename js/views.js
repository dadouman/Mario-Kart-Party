// ============================================================
// Vues principales : soirée, Grand Prix, saisie des courses.
// ============================================================

import {
  getState, save, flushSave, lastSession, findSession, getPlayers,
  newId, isPersistent,
} from './store.js';
import {
  h, render, toast, fmtDate, avatarEl, PLAYER_COLORS,
} from './ui.js';
import {
  raceComplete, gpFinished, sessionRanking, gpStandings,
  gpTitle,
} from './engine.js';
import { DrawPrefsEditor, startGrandPrix } from './draw.js';
import { gpUrl, launchGp, GpView, RaceView } from './gp.js';
import { openTv, TV_ICON } from './tv.js';

export { h, GpView, RaceView };

const S = () => getState();
const pl = (n, word) => n + ' ' + word + (n > 1 ? 's' : '');
const ongoingGp = (session) => session.grandPrix.slice().reverse()
  .find((gp) => !gpFinished(gp, session.playerIds.length));


function rankingList(session, players) {
  const playerById = Object.fromEntries(players.map((p) => [p.id, p]));
  const ranking = sessionRanking(session);
  return h('div', { class: 'stack' },
    ranking.map((row) => h('div', { class: 'rank-row' + (row.rank === 1 ? ' first' : '') },
      h('span', { class: 'rank-pos' }, String(row.rank)),
      playerById[row.pid] ? avatarEl(playerById[row.pid]) : null,
      h('span', { style: 'font-weight:600;flex:1' }, playerById[row.pid] ? playerById[row.pid].name : '?'),
      h('span', { class: 'rank-pts' }, row.pts + ' pts'))));
}

// ---------- Soirée (accueil) ----------

export function HomeView() {
  const st = S();
  const last = lastSession();

  if (!last) {
    return h('div', { class: 'stack fade-in' },
      h('h1', { class: 'page-title' }, 'Prêt pour la soirée ?'),
      storageWarning(),
      h('a', { class: 'btn btn-primary btn-block', href: '#/nouvelle-session', 'data-testid': 'button-new-session' }, 'Lancer une soirée'),
      h('a', { class: 'btn btn-ghost btn-block', href: '#/tirage', 'data-testid': 'link-express' }, 'Tirage express (sans scores)'));
  }

  const players = getPlayers(last.playerIds);
  const ongoing = ongoingGp(last);
  const past = st.sessions.slice(0, -1).slice(-5).reverse();

  return h('div', { class: 'stack fade-in' },
    storageWarning(),
    h('section', { class: 'card card-pad-lg stack', 'data-testid': 'card-current-session' },
      h('div', { class: 'spread' },
        h('div', {},
          h('h1', { class: 'page-title', style: 'margin:0' }, last.name),
          h('p', { class: 'sub', style: 'margin:2px 0 0' }, fmtDate(last.date) + ' · ' +
            pl(players.length, 'joueur') + ' · ' + last.grandPrix.length + ' GP')),
        h('a', { class: 'btn btn-ghost btn-sm', href: '#/session/' + last.id }, 'Détails')),
      rankingList(last, players),
      ongoing
        ? h('a', { class: 'btn btn-primary btn-block', href: gpUrl(last, ongoing), 'data-testid': 'link-resume' },
            'Reprendre le Grand Prix · ' + ongoing.races.filter((r) => raceComplete(r, players.length)).length +
            '/' + ongoing.races.length)
        : h('button', { class: 'btn btn-primary btn-block', 'data-testid': 'button-new-gp',
            onclick: () => launchGp(last) }, 'Nouveau Grand Prix')),
    h('div', { class: 'row' },
      h('a', { class: 'btn btn-outline', style: 'flex:1', href: '#/nouvelle-session', 'data-testid': 'button-new-session' }, 'Nouvelle soirée'),
      h('a', { class: 'btn btn-ghost', style: 'flex:1', href: '#/tirage', 'data-testid': 'link-express' }, 'Tirage express')),
    past.length
      ? h('section', {},
          h('h2', { class: 'section-title' }, 'Soirées précédentes'),
          h('div', { class: 'stack' }, past.map((s) => h('a', {
            class: 'card card-click spread', href: '#/session/' + s.id, style: 'text-decoration:none',
          },
            h('div', {}, h('strong', {}, s.name),
              h('div', { class: 'sub' }, fmtDate(s.date) + ' · ' + s.grandPrix.length + ' GP')),
            h('span', { 'aria-hidden': 'true' }, '›')))))
      : null);
}

function storageWarning() {
  return isPersistent() ? null : h('div', { class: 'warn-banner' },
    h('span', { 'aria-hidden': 'true' }, '⚠️'),
    h('div', {}, 'Aperçu intégré : la sauvegarde locale n\u2019est pas disponible ici. ',
      'Installez l\u2019application (menu du navigateur → « Ajouter à l\u2019écran d\u2019accueil ») pour conserver vos données.'));
}

// ---------- Nouvelle soirée ----------

export function NewSessionView() {
  const st = S();
  const previous = lastSession();
  const draft = {
    name: 'Soirée du ' + new Date().toLocaleDateString('fr-FR'),
    // Les joueurs de la dernière soirée sont présélectionnés.
    players: previous ? getPlayers(previous.playerIds).filter((p) => !p.archived) : [],
  };

  const nameInput = h('input', {
    class: 'input', type: 'text', value: draft.name,
    'data-testid': 'input-session-name', 'aria-label': 'Nom de la soirée',
  });
  nameInput.addEventListener('input', () => (draft.name = nameInput.value));

  const playerInput = h('input', {
    class: 'input', type: 'text', placeholder: 'Pseudonyme…',
    'data-testid': 'input-player-name', 'aria-label': 'Ajouter un joueur',
  });

  const chipsBox = h('div', { class: 'row' });
  const suggestionsBox = h('div', { class: 'row' });
  const chipsLabel = h('span', { class: 'chips-label' });
  const suggestionsBlock = h('div', { class: 'chips-group' },
    h('span', { class: 'chips-label' }, 'Déjà venus · touchez pour ajouter'), suggestionsBox);

  function refreshAll() { refreshChips(); refreshSuggestions(); createBtn.disabled = draft.players.length < 2; }

  function refreshChips() {
    chipsLabel.textContent = 'Dans la soirée · ' + draft.players.length;
    if (!draft.players.length) {
      chipsBox.replaceChildren(h('span', { class: 'sub' }, 'Aucun joueur pour l\'instant'));
      return;
    }
    chipsBox.replaceChildren(...draft.players.map((p, i) => h('button', {
      class: 'player-chip is-in', 'data-testid': 'chip-player-' + p.name,
      'aria-label': 'Retirer ' + p.name, title: 'Retirer',
      onclick: () => { draft.players.splice(i, 1); refreshAll(); },
    }, avatarEl(p), p.name, h('span', { 'aria-hidden': 'true' }, '×'))));
  }

  function refreshSuggestions() {
    const used = new Set(draft.players.map((p) => p.id));
    const favs = st.players.filter((p) => !p.archived && !used.has(p.id)).slice(-8).reverse();
    suggestionsBox.replaceChildren(...(favs.length ? [
      ...favs.map((p) => h('button', {
        class: 'player-chip is-suggest', 'data-testid': 'suggest-' + p.name,
        onclick: () => addPlayer(p.name, p),
      }, avatarEl(p), p.name, h('span', { 'aria-hidden': 'true' }, '+'))),
    ] : []));
    suggestionsBlock.hidden = !favs.length;
  }

  function addPlayer(name, existing) {
    name = (name || '').trim();
    if (!name) return;
    if (draft.players.length >= 12) { toast('12 joueurs maximum', 'err'); return; }
    if (draft.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      toast('Ce joueur est déjà dans la soirée');
      return;
    }
    let player = existing || st.players.find((p) => !p.archived && p.name.toLowerCase() === name.toLowerCase());
    if (!player) {
      player = {
        id: newId('p'), name,
        color: PLAYER_COLORS[st.players.length % PLAYER_COLORS.length],
        archived: false, createdAt: Date.now(),
      };
      st.players.push(player);
      save();
    }
    draft.players.push(player);
    playerInput.value = '';
    refreshAll();
  }

  const createBtn = h('button', {
    class: 'btn btn-primary btn-block', 'data-testid': 'button-create-session', disabled: true,
    onclick: () => {
      const session = {
        id: newId('s'), name: draft.name.trim() || 'Soirée', date: Date.now(),
        playerIds: draft.players.map((p) => p.id), grandPrix: [],
      };
      const gp = startGrandPrix(st, session);
      if (!gp) return;
      st.sessions.push(session);
      save();
      if (!flushSave()) return;
      location.hash = gpUrl(session, gp);
    },
  }, 'Lancer la soirée');

  playerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addPlayer(playerInput.value);
  });
  refreshAll();

  return h('div', { class: 'stack fade-in' },
    h('a', { class: 'back-link', href: '#/' }, '← Soirée'),
    h('h1', { class: 'page-title' }, 'Nouvelle soirée'),
    h('div', { class: 'card card-pad-lg stack' },
      h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Joueurs'),
        h('div', { class: 'row', style: 'margin-bottom:10px' },
          playerInput,
          h('button', {
            class: 'btn btn-ghost', 'data-testid': 'button-add-player',
            onclick: () => addPlayer(playerInput.value),
          }, 'Ajouter')),
        h('div', { class: 'chips-group is-in' }, chipsLabel, chipsBox),
        suggestionsBlock),
      h('details', { class: 'draw-options' },
        h('summary', {}, 'Nom de la soirée'), nameInput)),
    DrawPrefsEditor(st, { collapsed: true }),
    createBtn);
}

// ---------- Détail d'une soirée ----------

export function SessionView(sessionId) {
  const st = S();
  const session = findSession(sessionId);
  if (!session) return NotFound();

  const players = getPlayers(session.playerIds);
  const ongoing = ongoingGp(session);

  const gpCards = session.grandPrix.map((gp, index) => {
    const done = gp.races.filter((r) => raceComplete(r, players.length)).length;
    const finished = gpFinished(gp, players.length);
    const top = gpStandings(gp, players)[0];
    return h('a', {
      class: 'content-row card-click gp-line', href: gpUrl(session, gp),
      style: 'text-decoration:none', 'data-testid': 'card-gp-' + gp.id,
    },
      h('span', { class: 'gp-line-num' }, String(index + 1)),
      h('strong', { class: 'gp-line-name' }, gpTitle(session, gp)),
      h('span', { class: 'content-name sub' }, finished && top ? top.player.name + ' · ' + top.points + ' pts' : done + '/' + gp.races.length + ' courses'),
      finished ? null : h('span', { class: 'badge badge-primary' }, 'En cours'),
      h('span', { 'aria-hidden': 'true' }, '›'));
  }).reverse();

  return h('div', { class: 'stack fade-in' },
    h('a', { class: 'back-link', href: '#/' }, '← Soirée'),
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title' }, session.name),
        h('p', { class: 'sub' }, players.map((p) => p.name).join(', '))),
      h('button', { class: 'btn btn-outline btn-sm tv-open', 'data-testid': 'button-tv', onclick: () => openTv(session) },
        h('span', { class: 'gp-icon', 'aria-hidden': 'true', html: TV_ICON }), 'Grand écran')),
    h('div', { class: 'card' },
      h('h2', { class: 'section-title' }, 'Classement de la soirée'),
      rankingList(session, players)),
    h('div', { class: 'row' },
      ongoing
        ? h('a', { class: 'btn btn-primary', style: 'flex:1', href: gpUrl(session, ongoing), 'data-testid': 'link-resume-gp' },
            'Reprendre le GP')
        : null,
      h('button', { class: 'btn ' + (ongoing ? 'btn-outline' : 'btn-primary'), style: 'flex:1', 'data-testid': 'button-new-gp',
        onclick: () => launchGp(session) }, 'Nouveau Grand Prix')),
    DrawPrefsEditor(st, { collapsed: true }),
    h('section', {},
      h('h2', { class: 'section-title' }, 'Grands Prix'),
      gpCards.length
        ? h('div', { class: 'stack', style: 'gap:6px' }, gpCards)
        : h('p', { class: 'sub' }, 'Pas encore de Grand Prix.')));
}

// ---------- 404 ----------

export function NotFound() {
  return h('div', { class: 'stack fade-in' },
    h('h1', { class: 'page-title' }, 'Page introuvable'),
    h('p', { class: 'sub' }, 'Cette page n\u2019existe pas ou a été supprimée.'),
    h('a', { class: 'btn btn-primary', href: '#/' }, 'Retour à l\u2019accueil')
  );
}
