// ============================================================
// Vues principales : soirée, Grand Prix, saisie des courses.
// ============================================================

import {
  getState, save, flushSave, lastSession, findSession, getPlayers,
  newId, isPersistent,
} from './store.js';
import { PLAYER_COLORS } from './ui.js';
import {
  h, render, toast, confirmModal, fmtDate, avatarEl,
} from './ui.js';
import {
  raceComplete, gpPoints, gpConflicts, gpStandings, gpFinished,
  sessionRanking, pointsFor,
} from './engine.js';
import { DrawPrefsEditor, startGrandPrix, replaceRace } from './draw.js';
import { raceGame, gameStyle, gameBadge, gameLegend, timelineStep } from './race-visuals.js';

export { h };

const S = () => getState();
const pl = (n, word) => n + ' ' + word + (n > 1 ? 's' : '');
const gpUrl = (session, gp) => '#/session/' + session.id + '/gp/' + gp.id;
const ongoingGp = (session) => session.grandPrix.slice().reverse()
  .find((gp) => !gpFinished(gp, session.playerIds.length));

// Lance un nouveau GP dans la soirée et ouvre directement la chronologie.
function launchGp(session) {
  const gp = startGrandPrix(S(), session);
  if (!gp || !flushSave()) return;
  location.hash = gpUrl(session, gp);
}

function rankingList(session, players) {
  const playerById = Object.fromEntries(players.map((p) => [p.id, p]));
  const ranking = sessionRanking(session);
  const started = session.grandPrix.some((gp) => gp.races.some((r) => Object.keys(r.results || {}).length));
  if (!started) return h('p', { class: 'sub' }, 'Les points apparaissent dès la première course saisie.');
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
      h('div', {},
        h('h1', { class: 'page-title' }, 'Prêt pour la soirée ?'),
        h('p', { class: 'sub' }, 'Ajoutez les joueurs, les courses sont tirées au sort, saisissez les places. Tout reste sur cet appareil.')),
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

  function refreshAll() { refreshChips(); refreshSuggestions(); createBtn.disabled = draft.players.length < 2; }

  function refreshChips() {
    chipsBox.replaceChildren(...draft.players.map((p, i) => h('button', {
      class: 'player-chip', 'data-testid': 'chip-player-' + p.name,
      'aria-label': 'Retirer ' + p.name, title: 'Retirer',
      onclick: () => { draft.players.splice(i, 1); refreshAll(); },
    }, avatarEl(p), p.name, h('span', { 'aria-hidden': 'true' }, '×'))));
    if (!draft.players.length) chipsBox.append(h('span', { class: 'sub' }, 'Au moins 2 joueurs.'));
  }

  function refreshSuggestions() {
    const used = new Set(draft.players.map((p) => p.id));
    const favs = st.players.filter((p) => !p.archived && !used.has(p.id)).slice(-8).reverse();
    suggestionsBox.replaceChildren(...(favs.length ? [
      h('span', { class: 'sub', style: 'width:100%' }, 'Joueurs connus :'),
      ...favs.map((p) => h('button', {
        class: 'player-chip', 'data-testid': 'suggest-' + p.name,
        onclick: () => addPlayer(p.name, p),
      }, avatarEl(p), p.name, h('span', { 'aria-hidden': 'true' }, '+'))),
    ] : []));
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
        chipsBox,
        h('div', { class: 'row', style: 'margin-top:12px' }, suggestionsBox)),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Nom de la soirée'), nameInput)),
    DrawPrefsEditor(st, { collapsed: true }),
    createBtn,
    h('p', { class: 'sub' }, 'Le premier Grand Prix est tiré au sort et démarre tout de suite.'));
}

// ---------- Détail d'une soirée ----------

export function SessionView(sessionId) {
  const st = S();
  const session = findSession(sessionId);
  if (!session) return NotFound();

  const players = getPlayers(session.playerIds);
  const ongoing = ongoingGp(session);

  const gpCards = session.grandPrix.slice().reverse().map((gp) => {
    const done = gp.races.filter((r) => raceComplete(r, players.length)).length;
    const finished = gpFinished(gp, players.length);
    return h('a', {
      class: 'card card-click', href: gpUrl(session, gp),
      style: 'display:block;text-decoration:none', 'data-testid': 'card-gp-' + gp.id,
    },
      h('div', { class: 'spread' },
        h('div', { style: 'min-width:0' },
          h('div', { class: 'row' },
            h('strong', {}, gp.gameIcon + '  ' + gp.gameName),
            finished ? h('span', { class: 'badge badge-ok' }, 'Terminé') : h('span', { class: 'badge badge-primary' }, 'En cours')),
          h('div', { class: 'sub' }, gp.races.length + ' courses · ' + done + ' saisies')),
        h('span', { 'aria-hidden': 'true' }, '›')));
  });

  return h('div', { class: 'stack fade-in' },
    h('a', { class: 'back-link', href: '#/' }, '← Soirée'),
    h('div', {},
      h('h1', { class: 'page-title' }, session.name),
      h('p', { class: 'sub' }, fmtDate(session.date) + ' · ' + players.map((p) => p.name).join(', '))),
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
        ? h('div', { class: 'stack' }, gpCards)
        : h('p', { class: 'sub' }, 'Pas encore de Grand Prix.')));
}

// ---------- Grand Prix ----------

export function GpView(sessionId, gpId, requestedRaceNum = null) {
  const st = S();
  const session = findSession(sessionId);
  const gp = session && session.grandPrix.find((g) => g.id === gpId);
  if (!gp) return NotFound();

  const players = getPlayers(session.playerIds);
  const widgets = new Map();
  const ready = (r) => raceComplete(r, session.playerIds.length) && gpConflicts({ races: [r] }).length === 0;
  let nextRace = gp.races.find((r) => !ready(r));
  let activeRaceNum = gp.races.some((r) => r.num === requestedRaceNum) ? requestedRaceNum :
    nextRace?.num || null;
  const progressCount = h('strong');
  const progressState = h('span', { class: 'sub' });
  const progress = h('progress', { max: gp.races.length, value: 0, 'aria-label': 'Progression des courses' });
  const rankBox = h('div', { class: 'gp-podium-stands', 'data-testid': 'gp-live-ranking' });
  const fullRanking = h('div', { class: 'gp-full-ranking', hidden: true, id: 'gp-full-ranking', 'data-testid': 'gp-full-ranking', tabindex: '0', 'aria-label': 'Classement de tous les joueurs' });
  const podiumCaption = h('p', { class: 'gp-podium-caption' });
  const routeButtons = new Map();
  const route = h('nav', { class: 'gp-route', 'aria-label': 'Accès direct aux courses' },
    gp.races.map((race) => {
      const game = raceGame(race, gp);
      const shortName = /mario kart.*8/i.test(game.name) ? 'MK8' :
        /mario kart.*world/i.test(game.name) ? 'World' :
        game.name.split(/\s+/).map((word) => word[0]).slice(0, 4).join('');
      const button = h('button', {
        class: 'gp-route-stop', style: gameStyle(game),
        'data-testid': 'route-race-' + race.num,
        'aria-label': 'Course ' + race.num + ' : ' + race.contentName + ', ' + game.name,
        title: race.contentName + ' · ' + game.name,
        onclick: () => openRace(race.num),
      }, h('span', { class: 'gp-route-number' }, String(race.num).padStart(2, '0')),
      h('span', { class: 'gp-route-game' }, shortName));
      routeButtons.set(race.num, button);
      return button;
    }));
  const podium = h('aside', {
    class: 'gp-podium', 'aria-label': 'Podium du Grand Prix en direct', 'data-testid': 'gp-podium',
  },
    h('div', { class: 'gp-podium-heading' },
      h('div', {}, h('h2', {}, 'Le podium'), podiumCaption),
      h('button', {
        class: 'gp-ranking-link', 'data-testid': 'button-full-ranking',
        'aria-expanded': 'false', 'aria-controls': 'gp-full-ranking',
        onclick: (e) => {
          fullRanking.hidden = !fullRanking.hidden;
          rankBox.hidden = !fullRanking.hidden;
          e.currentTarget.textContent = fullRanking.hidden ? 'Tout voir' : 'Podium';
          e.currentTarget.setAttribute('aria-expanded', String(!fullRanking.hidden));
        },
      }, 'Tout voir')),
    rankBox, fullRanking, route);
  const nextButton = h('button', {
    class: 'btn btn-outline btn-block', 'data-testid': 'button-next-race',
    onclick: () => { if (nextRace) openRace(nextRace.num); },
  });

  // Fin du GP : pas de validation, les points comptent déjà. On enchaîne.
  const nextGpBtn = h('button', {
    class: 'btn btn-primary btn-block', 'data-testid': 'button-next-gp',
    onclick: () => launchGp(session),
  }, 'Grand Prix suivant');
  const completion = h('div', { class: 'card stack gp-completion', hidden: true, 'data-testid': 'gp-completion' },
    h('strong', {}, 'Grand Prix terminé'),
    h('p', { class: 'sub' }, 'Les points sont au classement de la soirée. Les places restent modifiables.'),
    nextGpBtn,
    h('a', { class: 'btn btn-ghost btn-block', href: '#/session/' + sessionId }, 'Classement de la soirée'));

  function refreshGp() {
    nextRace = gp.races.find((r) => !ready(r));
    const doneCount = gp.races.filter(ready).length;
    progressCount.textContent = doneCount + ' / ' + gp.races.length + ' courses saisies';
    progress.value = doneCount;
    const finished = !nextRace;
    progressState.textContent = finished ? 'Grand Prix terminé' : 'À renseigner : course ' + nextRace.num;
    completion.hidden = !finished;
    nextButton.hidden = finished || nextRace.num === activeRaceNum;
    nextButton.textContent = nextRace ? 'Reprendre la course ' + nextRace.num : '';
    widgets.forEach((w, num) => {
      const done = ready(w.race), open = num === activeRaceNum;
      w.button.setAttribute('aria-expanded', String(open));
      w.button.setAttribute('aria-current', open ? 'step' : 'false');
      w.button.classList.toggle('done', done);
      w.shell.classList.toggle('is-open', open);
      w.step.classList.toggle('is-done', done);
      w.step.classList.toggle('is-current', open);
      w.name.textContent = w.race.contentName;
      w.edition.textContent = w.race.editionName || 'Jeu de base';
      w.label.textContent = open ? 'COURSE OUVERTE' :
        w.race === nextRace ? 'PROCHAINE COURSE' :
        num === gp.races[0].num ? 'DÉPART' :
        num === gp.races.at(-1).num ? 'DERNIÈRE COURSE' : '';
      w.label.hidden = !w.label.textContent;
      w.badge.textContent = done ? 'Saisie' : open ? 'En cours' : 'À saisir';
      w.badge.className = 'badge ' + (done ? 'badge-ok' : open ? 'badge-primary' : '');
      const stop = routeButtons.get(num);
      stop.classList.toggle('is-done', done);
      stop.classList.toggle('is-current', open);
      stop.setAttribute('aria-current', open ? 'step' : 'false');
      stop.title = w.race.contentName + ' · ' + raceGame(w.race, gp).name;
      stop.setAttribute('aria-label', 'Course ' + num + ' : ' + w.race.contentName + ', ' +
        raceGame(w.race, gp).name + (done ? ', saisie' : ', à saisir') + (open ? ', ouverte' : ''));
    });
    rankBox.innerHTML = '';
    const standings = gpStandings(gp, players);
    fullRanking.replaceChildren(...standings.map(({ player, points, rank }) =>
      h('div', { class: 'rank-row' + (rank === 1 ? ' first' : '') },
        h('span', { class: 'rank-pos' }, String(rank)), avatarEl(player),
        h('strong', { class: 'gp-full-rank-name' }, player.name),
        h('span', { class: 'rank-pts' }, points + ' pts'))));
    const tied = standings.some((row, index) => index && row.points === standings[index - 1].points);
    const hasResults = gp.races.some((race) => Object.keys(race.results || {}).length);
    podiumCaption.textContent = (finished ? 'Final' : !hasResults ? 'Départ à égalité' : 'Provisoire') +
      (tied && hasResults ? ' · ex æquo' : '') + ' · ' + doneCount + '/' + gp.races.length;
    [1, 0, 2].forEach((index) => {
      const row = standings[index];
      const rank = row?.rank || index + 1;
      const label = rank === 1 ? '1er' : rank + 'e';
      rankBox.append(h('div', {
        class: 'gp-podium-place tier-' + Math.min(rank, 3) + (!row ? ' is-empty' : ''),
        'data-player-id': row?.player.id,
        'aria-label': row ? row.player.name + ' : rang ' + rank + ', ' + row.points + ' points' : 'Place libre',
      },
        h('span', { class: 'gp-podium-name', title: row?.player.name || 'Place libre' }, row?.player.name || '—'),
        h('strong', { class: 'gp-podium-points' }, row ? String(row.points) : '—',
          h('span', {}, ' pts')),
        h('div', { class: 'gp-podium-plinth', 'aria-hidden': 'true' },
          h('span', {}, row ? label : '—'))));
    });
  }

  function openRace(num, scroll = true) {
    activeRaceNum = num;
    widgets.forEach((w, raceNum) => {
      const open = raceNum === num;
      w.panel.hidden = !open;
      if (open && !w.panel.firstChild) {
        w.editor = ScoreEntry(sessionId, gpId, raceNum, {
          onChange: refreshGp,
          onSaved: (next) => {
            openRace(next?.num || null);
            if (!next) {
              nextGpBtn.focus({ preventScroll: true });
              completion.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          },
        });
        w.panel.append(w.editor);
      }
      if (open) w.editor.refreshScores();
    });
    refreshGp();
    const current = widgets.get(num);
    if (scroll && current) {
      current.button.focus({ preventScroll: true });
      current.shell.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  const raceList = h('ol', { class: 'race-timeline gp-timeline', 'aria-label': 'Chronologie du Grand Prix' },
    gp.races.map((race, index) => {
      const game = raceGame(race, gp);
      const done = ready(race);
      const next = race.num === activeRaceNum;
      const panelId = 'gp-score-panel-' + gp.id + '-' + race.num;
      const panel = h('div', {
        class: 'gp-inline-score', id: panelId, hidden: true,
        role: 'region', 'aria-label': 'Scores de la course ' + race.num,
      });
      const badge = h('span', { class: 'badge' }, done ? 'Saisie' : 'À saisir');
      const name = h('span', { class: 'timeline-course-name' }, race.contentName);
      const edition = h('span', { class: 'sub', style: 'font-size:.75rem;display:block' }, race.editionName || 'Jeu de base');
      const btn = h('button', {
        class: 'race-item' + (done ? ' done' : ''),
        style: gameStyle(game),
        'data-testid': 'race-' + race.num,
        'aria-controls': panelId, 'aria-expanded': String(next),
        onclick: () => openRace(activeRaceNum === race.num ? null : race.num),
      },
        h('span', { style: 'flex:1;text-align:left;min-width:0' },
          gameBadge(game), name, edition
        ),
        h('span', { class: 'gp-race-summary' }, badge,
          h('span', { class: 'gp-expand-mark', 'aria-hidden': 'true' }, '⌄'))
      );
      const shell = h('div', { class: 'gp-race-shell timeline-card', style: gameStyle(game) }, btn, panel);
      const step = timelineStep({
        index, game, previousGame: index ? raceGame(gp.races[index - 1], gp) : null,
        card: shell, label: ' ',
      });
      widgets.set(race.num, { race, button: btn, badge, shell, panel, step, name, edition, label: step.querySelector('.timeline-label') });
      return step;
    })
  );

  const view = h('div', { class: 'fade-in gp-unified-page' },
    h('header', { class: 'stack gp-intro' },
    h('a', { class: 'back-link', href: '#/session/' + sessionId }, '← ' + session.name),
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title' }, 'Grand Prix'),
        h('p', { class: 'sub' }, gp.races.length + ' courses · ' +
          new Set(gp.races.map((race) => raceGame(race, gp).id)).size + ' jeu(x)')
      ),
      h('button', {
        class: 'btn btn-ghost btn-sm', 'data-testid': 'button-cancel-gp',
        onclick: () => confirmModal({
          title: 'Supprimer ce Grand Prix ?',
          message: 'Ses courses et ses points seront retirés de la soirée.',
          confirmLabel: 'Supprimer', danger: true,
          onConfirm: () => {
            session.grandPrix = session.grandPrix.filter((g) => g.id !== gp.id);
            save();
            toast('Grand Prix supprimé');
            location.hash = '#/session/' + sessionId;
          },
        }),
      }, 'Supprimer')
    ),
    ),
    podium,
    h('section', { class: 'gp-chronology', 'aria-label': 'Chronologie et saisie des courses' },
    h('div', { class: 'card stack gp-progress' },
      h('div', { class: 'spread' },
        progressCount, progressState),
      progress, nextButton),
      h('h2', { class: 'section-title' }, 'Course après course'),
      h('p', { class: 'sub gp-unified-help' }, 'Saisis les places sous la course ouverte. Le podium suit en direct.'),
      raceList,
      h('div', { class: 'timeline-finish' }, 'ARRIVÉE'),
      completion
    )
  );
  openRace(activeRaceNum, false);
  // Au chargement, montrer immédiatement la course à jouer, pas un long préambule.
  requestAnimationFrame(() => {
    if (view.isConnected && activeRaceNum) {
      widgets.get(activeRaceNum)?.shell.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  });
  return view;
}

// ---------- Saisie d'une course ----------

function ScoreEntry(sessionId, gpId, raceNum, { onChange, onSaved } = {}) {
  const st = S();
  const session = findSession(sessionId);
  const gp = session && session.grandPrix.find((g) => g.id === gpId);
  const race = gp && gp.races.find((r) => r.num === raceNum);
  if (!race) return NotFound();

  const players = getPlayers(session.playerIds);
  race.results = race.results || {};
  const controls = new Map();
  const incomplete = (r) => !raceComplete(r, players.length) || gpConflicts({ races: [r] }).length;
  const getNext = () => gp.races.find((r) => r.num > race.num && incomplete(r)) ||
    gp.races.find((r) => r.num !== race.num && incomplete(r));
  const message = h('p', { class: 'score-feedback sub', role: 'status', 'aria-live': 'polite' });
  const saveBtn = h('button', {
    class: 'btn btn-primary btn-block score-submit', disabled: true,
    'data-testid': 'button-save-scores',
    onclick: () => {
      if (!refreshFeedback()) return;
      if (!flushSave()) {
        toast('Sauvegarde impossible sur cet appareil. Vos saisies restent disponibles dans cet onglet.', 'err');
        return;
      }
      onSaved?.(getNext());
    },
  }, 'Enregistrer');

  // Tant que la course n'est pas jouée, on peut changer de circuit.
  const replaceBtn = h('button', {
    class: 'btn btn-ghost btn-sm', 'data-testid': 'button-replace-race-' + race.num,
    onclick: () => {
      if (Object.keys(race.results).length) return;
      if (replaceRace(st, gp, race)) {
        toast('Nouveau circuit : ' + race.contentName);
        onChange?.();
      }
    },
  }, 'Changer de circuit');

  function validPlace(raw) {
    return /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) >= 1;
  }
  function refreshFeedback() {
    const counts = new Map();
    players.forEach((p) => {
      const res = race.results[p.id];
      if (res && typeof res.pos === 'number') counts.set(res.pos, (counts.get(res.pos) || 0) + 1);
    });
    let invalid = 0, clashes = 0, filled = 0;
    controls.forEach((c, pid) => {
      const res = race.results[pid] || {};
      const raw = c.input.value.trim();
      const bad = raw !== '' && !validPlace(raw);
      const clash = typeof res.pos === 'number' && counts.get(res.pos) > 1;
      const error = bad ? 'Saisis un nombre entier à partir de 1.' :
        clash ? 'Place ' + res.pos + ' déjà utilisée.' : '';
      c.input.setAttribute('aria-invalid', String(!!error));
      c.row.classList.toggle('has-error', !!error);
      c.error.textContent = error;
      c.error.hidden = !error;
      const pts = bad ? null : pointsFor(res, gp.bareme);
      c.points.textContent = pts === null ? '—' : String(pts);
      c.points.classList.toggle('has-points', pts !== null);
      if (bad) invalid++;
      if (clash) clashes++;
      if (res.status || (!bad && typeof res.pos === 'number')) filled++;
    });
    const ready = !invalid && !clashes && filled === players.length;
    replaceBtn.hidden = Object.keys(race.results).length > 0;
    saveBtn.disabled = !ready;
    saveBtn.textContent = getNext() ? 'Enregistrer et passer à la suivante' : 'Enregistrer et terminer le Grand Prix';
    message.textContent =
      clashes ? 'Deux joueurs ne peuvent pas avoir la même place.' :
      invalid ? 'Corrige les places signalées avant de continuer.' :
      ready ? 'Tout est renseigné. Tu peux continuer.' :
      'Renseigne la place de chaque joueur.';
    return ready;
  }

  const rows = players.map((p, index) => {
    const res = race.results[p.id] || {};
    const errorId = 'score-error-' + gp.id + '-' + race.num + '-' + p.id;
    const input = h('input', {
      class: 'score-place', type: 'text', inputmode: 'numeric', pattern: '[0-9]*',
      enterkeyhint: index < players.length - 1 ? 'next' : 'done',
      autocomplete: 'off', placeholder: '—', value: res.pos == null ? '' : res.pos,
      'aria-label': 'Place de ' + p.name, 'aria-describedby': errorId,
      'data-testid': 'input-place-' + p.id,
      onfocus: () => input.select(),
      oninput: () => {
        const raw = input.value.trim();
        if (validPlace(raw)) race.results[p.id] = { pos: Number(raw) };
        else delete race.results[p.id];
        save();
        refreshFeedback();
        onChange?.();
      },
      onkeydown: (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const following = [...controls.values()].slice(index + 1)[0];
        if (following) following.input.focus();
        else if (!saveBtn.disabled) saveBtn.click();
      },
    });
    const points = h('output', {
      class: 'score-points', 'aria-label': 'Points de ' + p.name,
      'data-testid': 'points-' + p.id,
    });
    const error = h('p', { class: 'score-field-error', id: errorId, hidden: true });
    const row = h('div', { class: 'score-row' },
      h('div', { class: 'score-player' },
        h('div', { class: 'score-player-name' }, avatarEl(p), h('strong', {}, p.name))),
      input, points, error);
    controls.set(p.id, { row, input, points, error });
    return row;
  });
  refreshFeedback();
  const editor = h('div', { class: 'stack score-inline-editor' },
    h('div', { class: 'spread' },
      h('p', { class: 'sub score-inline-hint', style: 'margin:0' }, 'Place réelle dans le jeu, bots compris.'),
      replaceBtn),
    h('section', { class: 'score-sheet', 'aria-label': 'Places et points de la course ' + race.num },
      h('div', { class: 'score-columns', 'aria-hidden': 'true' },
        h('span', {}, 'Joueur'), h('span', {}, 'Place'), h('span', {}, 'Points')),
      ...rows),
    h('div', { class: 'stack score-footer' }, message, saveBtn));
  editor.refreshScores = refreshFeedback;
  return editor;
}

// Compatibilité avec les anciens liens : même écran, course demandée ouverte.
export function RaceView(sessionId, gpId, raceNum) {
  const session = findSession(sessionId);
  const gp = session && session.grandPrix.find((g) => g.id === gpId);
  if (!gp || !gp.races.some((r) => r.num === raceNum)) return NotFound();
  return GpView(sessionId, gpId, raceNum);
}

// ---------- 404 ----------

export function NotFound() {
  return h('div', { class: 'stack fade-in' },
    h('h1', { class: 'page-title' }, 'Page introuvable'),
    h('p', { class: 'sub' }, 'Cette page n\u2019existe pas ou a été supprimée.'),
    h('a', { class: 'btn btn-primary', href: '#/' }, 'Retour à l\u2019accueil')
  );
}
