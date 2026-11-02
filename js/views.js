// ============================================================
// Vues principales : accueil, session, Grand Prix, saisie des courses.
// ============================================================

import {
  getState, save, flushSave, lastSession, findSession, findGame, getPlayers,
  activeGames, gameContents, newId, isPersistent,
} from './store.js';
import { PLAYER_COLORS } from './ui.js';
import {
  h, render, toast, modal, confirmModal, fmtDate, avatarEl,
} from './ui.js';
import {
  drawItems, eligibleItems, raceComplete, gpComplete, gpPoints, gpConflicts, gpStandings,
  sessionRanking, RACE_STATUSES, pointsFor,
} from './engine.js';

import { setPendingDraw, clearPendingDraw, getPendingDraw } from './pending.js';
import { raceGame, gameStyle, gameBadge, gameLegend, timelineStep } from './race-visuals.js';

export { h };

const S = () => getState();
const pl = (n, word) => n + ' ' + word + (n > 1 ? 's' : '');

// Construit un objet Grand Prix à partir de contenus tirés (un ou plusieurs jeux).
export function buildGpFromItems(st, items) {
  const gameIds = [...new Set(items.map((c) => c.gameId).filter(Boolean))];
  let gameName = 'Multi-jeux';
  let gameIcon = '🎮';
  let gameId = 'multi';
  if (gameIds.length === 1) {
    const g = st.games.find((x) => x.id === gameIds[0]);
    if (g) { gameName = g.name; gameIcon = g.icon; gameId = g.id; }
  }
  const editionNames = [...new Set(items.map((c) => c.editionName).filter(Boolean))];
  return {
    id: newId('gp'),
    gameId, gameName, gameIcon,
    multiGame: gameIds.length > 1,
    editionNames,
    bareme: st.settings.bareme.slice(),
    createdAt: Date.now(),
    validated: false,
    points: {},
    history: [],
    races: items.map((c, i) => ({
      id: newId('r'), num: i + 1, contentId: c.id, contentName: c.name,
      editionName: c.editionName, results: {},
      gameId: c.gameId || null, gameName: c.gameName || null, gameIcon: c.gameIcon || null,
    })),
  };
}

// ---------- Petits composants ----------

function playerChip(p) {
  return h('span', { class: 'player-chip' }, avatarEl(p), p.name);
}

function emptyState(title, text, action) {
  return h('div', { class: 'empty-state' },
    h('h3', {}, title),
    h('p', {}, text),
    action
  );
}

// ---------- Accueil ----------

export function HomeView() {
  const st = S();
  const sessions = st.sessions;
  const gpsTotal = sessions.reduce((n, s) => n + s.grandPrix.filter((g) => g.validated).length, 0);
  const last = lastSession();

  const view = h('div', { class: 'stack fade-in' },
    h('div', {},
      h('h1', { class: 'page-title' }, 'Prêt pour la soirée ?'),
      h('p', { class: 'sub' }, 'Tirages aléatoires, Grands Prix et classements — tout se passe sur cet appareil, sans compte.')
    ),
    !isPersistent()
      ? h('div', { class: 'warn-banner' },
          h('span', { 'aria-hidden': 'true' }, '⚠️'),
          h('div', {},
            'Aperçu intégré : la sauvegarde locale n\u2019est pas disponible ici. ',
            'Installez l\u2019application sur votre appareil (menu du navigateur → « Ajouter à l\u2019écran d\u2019accueil ») pour conserver vos données.'
          )
        )
      : null,
    h('div', { class: 'stats-grid' },
      h('div', { class: 'stat-tile' }, h('div', { class: 'stat-val' }, String(sessions.length)), h('div', { class: 'stat-label' }, pl(sessions.length, 'Session'))),
      h('div', { class: 'stat-tile' }, h('div', { class: 'stat-val' }, String(gpsTotal)), h('div', { class: 'stat-label' }, pl(gpsTotal, 'GP validé'))),
      h('div', { class: 'stat-tile' }, h('div', { class: 'stat-val' }, String(st.players.length)), h('div', { class: 'stat-label' }, pl(st.players.length, 'Joueur')))
    ),
    last
      ? h('a', { class: 'card card-click', href: '#/session/' + last.id, style: 'display:block;text-decoration:none' },
          h('div', { class: 'spread' },
            h('div', {},
              h('div', { class: 'row', style: 'margin-bottom:2px' },
                h('strong', {}, last.name),
                last.status === 'open' ? h('span', { class: 'badge badge-ok' }, 'En cours') : h('span', { class: 'badge' }, 'Terminée')
              ),
              h('div', { class: 'sub' }, fmtDate(last.date) + ' · ' + last.playerIds.length + ' joueurs')
            ),
            h('span', { class: 'btn btn-ghost btn-sm' }, 'Reprendre')
          )
        )
      : null,
    h('div', {},
      h('a', { class: 'btn btn-primary btn-block', href: '#/nouvelle-session' }, 'Nouvelle session'),
      h('div', { class: 'row', style: 'margin-top:10px' },
        h('a', { class: 'btn btn-ghost', href: '#/tirage', style: 'flex:1' }, 'Tirage rapide'),
        h('a', { class: 'btn btn-ghost', href: '#/jeux', style: 'flex:1' }, 'Jeux')
      )
    ),
    sessions.length
      ? h('section', {},
          h('h2', { class: 'section-title' }, 'Sessions récentes'),
          h('div', { class: 'stack' },
            sessions.slice(-5).reverse().map((s) =>
              h('a', {
                class: 'card card-click', href: '#/session/' + s.id,
                style: 'display:block;text-decoration:none',
              },
                h('div', { class: 'spread' },
                  h('div', {},
                    h('strong', {}, s.name),
                    h('div', { class: 'sub' }, fmtDate(s.date) + ' · ' + s.grandPrix.length + ' GP')
                  ),
                  s.status === 'open'
                    ? h('span', { class: 'badge badge-ok' }, 'En cours')
                    : h('span', { class: 'badge' }, 'Terminée')
                )
              )
            )
          )
        )
      : null
  );
  return view;
}

// ---------- Nouvelle session ----------

export function NewSessionView() {
  const st = S();
  const draft = { name: 'Soirée du ' + new Date().toLocaleDateString('fr-FR'), players: [] };

  const nameInput = h('input', {
    class: 'input', type: 'text', value: draft.name,
    'data-testid': 'input-session-name', 'aria-label': 'Nom de la session',
  });
  nameInput.addEventListener('input', () => (draft.name = nameInput.value));

  const playerInput = h('input', {
    class: 'input', type: 'text', placeholder: 'Pseudonyme…',
    'data-testid': 'input-player-name', 'aria-label': 'Ajouter un joueur',
  });

  const chipsBox = h('div', { class: 'row' });
  const suggestionsBox = h('div', { class: 'row' });

  function refreshChips() {
    chipsBox.innerHTML = '';
    draft.players.forEach((p, i) => {
      const btn = h('button', {
        class: 'player-chip', 'data-testid': 'chip-player-' + p.name,
        'aria-label': 'Retirer ' + p.name, title: 'Retirer',
        onclick: () => { draft.players.splice(i, 1); refreshChips(); refreshSuggestions(); refreshCreate(); },
      }, avatarEl(p), p.name, h('span', { 'aria-hidden': 'true' }, '×'));
      chipsBox.append(btn);
    });
    if (!draft.players.length) {
      chipsBox.append(h('span', { class: 'sub' }, 'Au moins 2 joueurs pour lancer un Grand Prix.'));
    }
  }

  function refreshSuggestions() {
    suggestionsBox.innerHTML = '';
    const used = new Set(draft.players.map((p) => p.id));
    const favs = st.players.filter((p) => !p.archived && !used.has(p.id)).slice(-8).reverse();
    if (favs.length) {
      suggestionsBox.append(h('span', { class: 'sub', style: 'width:100%' }, 'Joueurs connus :'));
      favs.forEach((p) => {
        suggestionsBox.append(h('button', {
          class: 'player-chip', 'data-testid': 'suggest-' + p.name,
          onclick: () => addPlayer(p.name, p),
        }, avatarEl(p), p.name, h('span', { 'aria-hidden': 'true' }, '+')));
      });
    }
  }

  function addPlayer(name, existing) {
    name = (name || '').trim();
    if (!name) return;
    if (draft.players.length >= 12) { toast('12 joueurs maximum', 'err'); return; }
    if (draft.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      toast('Ce joueur est déjà dans la session');
      return;
    }
    let player = existing;
    if (!player) {
      player = st.players.find((p) => !p.archived && p.name.toLowerCase() === name.toLowerCase());
    }
    if (!player) {
      player = {
        id: newId('p'), name,
        color: PLAYER_COLORS[st.players.length % PLAYER_COLORS.length],
        archived: false, createdAt: Date.now(),
      };
      st.players.push(player);
    }
    draft.players.push(player);
    save();
    playerInput.value = '';
    refreshChips(); refreshSuggestions(); refreshCreate();
  }

  function refreshCreate() {
    createBtn.disabled = draft.players.length < 2;
  }

  const createBtn = h('button', {
    class: 'btn btn-primary btn-block', 'data-testid': 'button-create-session', disabled: true,
    onclick: () => {
      const session = {
        id: newId('s'), name: draft.name.trim() || 'Session', date: Date.now(),
        status: 'open', playerIds: draft.players.map((p) => p.id),
        grandPrix: [], draws: [],
      };
      st.sessions.push(session);
      let pendingGp = null;
      const pending = getPendingDraw();
      if (pending && pending.length) {
        pendingGp = buildGpFromItems(st, pending);
        session.grandPrix.push(pendingGp);
        clearPendingDraw();
      }
      save();
      toast('Session créée');
      location.hash = pendingGp
        ? '#/session/' + session.id + '/gp/' + pendingGp.id
        : '#/session/' + session.id;
    },
  }, 'Créer la session');

  const pending = getPendingDraw();
  const view = h('div', { class: 'stack fade-in' },
    h('a', { class: 'back-link', href: '#/' }, '← Accueil'),
    h('h1', { class: 'page-title' }, 'Nouvelle session'),
    pending && pending.length
      ? h('div', { class: 'card card-pad-lg stack', 'data-testid': 'card-pending-draw' },
          h('div', { class: 'spread' },
            h('div', {},
              h('strong', {}, 'Tirage en attente'),
              h('p', { class: 'sub', style: 'margin:4px 0 0' },
                pending.length + ' courses tirées seront ajoutées comme premier Grand Prix :'),
              h('p', { class: 'sub', style: 'margin:2px 0 0' },
                pending.map((c) => (c.gameIcon ? c.gameIcon + ' ' : '') + c.name).join(' · '))
            ),
            h('button', {
              class: 'btn btn-ghost btn-sm',
              'data-testid': 'button-discard-draw',
              onclick: () => { clearPendingDraw(); render(NewSessionView()); },
            }, 'Annuler')
          )
        )
      : null,
    h('div', { class: 'card card-pad-lg stack' },
      h('label', { class: 'field' },
        h('span', { class: 'field-label' }, 'Nom de la soirée'), nameInput),
      h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Joueurs'),
        h('div', { class: 'row', style: 'margin-bottom:10px' },
          playerInput,
          h('button', {
            class: 'btn btn-ghost', 'data-testid': 'button-add-player',
            onclick: () => addPlayer(playerInput.value),
          }, 'Ajouter')
        ),
        chipsBox,
        h('div', { class: 'row', style: 'margin-top:12px' }, suggestionsBox)
      ),
      createBtn,
      h('p', { class: 'sub' }, 'Les joueurs créés ici sont conservés : vous les retrouverez pour les prochaines soirées.')
    )
  );

  playerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addPlayer(playerInput.value);
  });

  refreshChips(); refreshSuggestions();
  return view;
}

// ---------- Détail de session ----------

export function SessionView(sessionId) {
  const st = S();
  const session = findSession(sessionId);
  if (!session) return NotFound();

  const ranking = sessionRanking(session);
  const players = getPlayers(session.playerIds);
  const playerById = Object.fromEntries(players.map((p) => [p.id, p]));

  function newGpModal() {
    const games = activeGames();
    if (!games.length) {
      toast('Ajoutez d\u2019abord un jeu dans la bibliothèque', 'err');
      location.hash = '#/jeux';
      return;
    }
    if (session.playerIds.length < 2) {
      toast('Il faut au moins 2 joueurs pour un Grand Prix', 'err');
      return;
    }

    // Multi-jeux : on peut sélectionner plusieurs jeux, les courses seront tirées
    // dans l'union de leurs contenus (éditions actives par défaut).
    const selectedGames = new Set(games.map((g) => g.id));
    const editionsByGame = new Map(games.map((g) => [g.id, new Set(g.editions.filter((e) => e.active).map((e) => e.id))]));
    let raceCount = 4;
    let unique = true;
    let excludeRecent = false;

    const gamesBox = h('div', { class: 'stack' });
    const editionsBox = h('div', { class: 'stack' });
    function refreshGames() {
      gamesBox.innerHTML = '';
      games.forEach((g) => {
        const cb = h('input', { type: 'checkbox' });
        cb.checked = selectedGames.has(g.id);
        cb.addEventListener('change', () => {
          if (cb.checked) selectedGames.add(g.id);
          else if (selectedGames.size > 1) selectedGames.delete(g.id);
          else { cb.checked = true; toast('Gardez au moins un jeu sélectionné'); return; }
          refreshGames(); refreshEditions(); refreshInfo();
        });
        const n = gameContents(g, [...editionsByGame.get(g.id)]).length;
        gamesBox.append(h('label', { class: 'content-row', style: 'cursor:pointer' }, cb,
          h('span', { class: 'content-name' }, g.icon + '  ' + g.name),
          h('span', { class: 'badge' }, n + ' contenus')
        ));
      });
    }
    function refreshEditions() {
      editionsBox.innerHTML = '';
      const sel = games.filter((g) => selectedGames.has(g.id));
      if (sel.length > 1) {
        editionsBox.append(h('span', { class: 'sub' }, 'Éditions actives de chaque jeu sélectionné :'));
      }
      sel.forEach((g) => {
        if (sel.length > 1) editionsBox.append(h('div', { class: 'field-label', style: 'margin-top:4px' }, g.icon + '  ' + g.name));
        g.editions.forEach((ed) => {
          const cb = h('input', { type: 'checkbox' });
          cb.checked = editionsByGame.get(g.id).has(ed.id);
          cb.addEventListener('change', () => {
            if (cb.checked) editionsByGame.get(g.id).add(ed.id);
            else editionsByGame.get(g.id).delete(ed.id);
            refreshInfo();
          });
          editionsBox.append(h('label', { class: 'content-row', style: 'cursor:pointer' }, cb,
            h('span', { class: 'content-name' }, ed.name + (ed.dlc ? ' (DLC)' : '')),
            h('span', { class: 'badge' }, ed.contents.length + ' contenus')
          ));
        });
      });
    }

    function currentPool() {
      return games
        .filter((g) => selectedGames.has(g.id))
        .flatMap((g) => gameContents(g, [...editionsByGame.get(g.id)]));
    }

    const countInput = h('input', {
      class: 'input', type: 'number', min: 1, max: 24, value: 4,
      style: 'max-width:100px', 'aria-label': 'Nombre de courses',
    });
    countInput.addEventListener('input', () => {
      raceCount = Math.max(1, Math.min(24, parseInt(countInput.value, 10) || 4));
      refreshInfo();
    });

    const uniqueToggle = mkToggle(true, (v) => { unique = v; refreshInfo(); });
    const recentToggle = mkToggle(false, (v) => { excludeRecent = v; refreshInfo(); });

    const infoBox = h('p', { class: 'sub' });
    const createBtn = h('button', { class: 'btn btn-primary btn-block', 'data-testid': 'button-create-gp' }, 'Tirer les courses');

    function usedContentIds() {
      const ids = new Set();
      for (const gp of session.grandPrix) for (const r of gp.races) if (r.contentId) ids.add(r.contentId);
      return ids;
    }

    function refreshInfo() {
      const contents = currentPool();
      const eligible = eligibleItems(contents, { excludeIds: excludeRecent ? [...usedContentIds()] : [] });
      infoBox.textContent = eligible.length + ' contenus éligibles';
      if (!eligible.length) {
        infoBox.textContent = 'Aucun contenu éligible — activez des éditions ou vérifiez la bibliothèque.';
        createBtn.disabled = true;
      } else if (unique && eligible.length < raceCount) {
        infoBox.textContent = 'Seulement ' + eligible.length + ' contenus éligibles : réduisez le nombre de courses, élargissez les éditions ou autorisez les doublons.';
        createBtn.disabled = true;
      } else {
        createBtn.disabled = false;
      }
    }

    createBtn.addEventListener('click', () => {
      const contents = currentPool();
      const res = drawItems(eligibleItems(contents, { excludeIds: excludeRecent ? [...usedContentIds()] : [] }), {
        count: raceCount, unique,
      });
      if (res.error) { refreshInfo(); return; }
      const gp = buildGpFromItems(st, res.items);
      session.grandPrix.push(gp);
      save();
      close();
      toast(raceCount + ' courses tirées');
      location.hash = '#/session/' + session.id + '/gp/' + gp.id;
    });

    refreshGames();
    refreshEditions();
    const close = modal({
      title: 'Nouveau Grand Prix',
      body: h('div', { class: 'stack' },
        h('div', { class: 'field' },
          h('span', { class: 'field-label' }, 'Jeux (plusieurs possibles)'),
          gamesBox
        ),
        h('div', { class: 'field' },
          h('span', { class: 'field-label' }, 'Éditions / extensions'),
          editionsBox
        ),
        h('label', { class: 'field' },
          h('span', { class: 'field-label' }, 'Nombre de courses'),
          countInput
        ),
        h('div', { class: 'spread' }, h('span', {}, 'Interdire les doublons'), uniqueToggle),
        h('div', { class: 'spread' }, h('span', {}, 'Exclure les circuits déjà joués cette session'), recentToggle),
        infoBox,
        createBtn
      ),
      actions: [{ label: 'Annuler' }],
    });
    refreshInfo();
  }

  const gpCards = session.grandPrix.map((gp) => {
    const done = gp.races.filter((r) => raceComplete(r)).length;
    return h('a', {
      class: 'card card-click', href: '#/session/' + session.id + '/gp/' + gp.id,
      style: 'display:block;text-decoration:none', 'data-testid': 'card-gp-' + gp.id,
    },
      h('div', { class: 'spread' },
        h('div', { style: 'min-width:0' },
          h('div', { class: 'row' },
            h('strong', {}, gp.gameIcon + '  ' + gp.gameName),
            gp.validated ? h('span', { class: 'badge badge-ok' }, 'Validé') : h('span', { class: 'badge badge-primary' }, 'En cours')
          ),
          h('div', { class: 'sub' },
            gp.races.length + ' courses · ' + done + ' saisies' +
            (gp.editionNames.length ? ' · ' + gp.editionNames.join(', ') : '')
          )
        ),
        h('span', { 'aria-hidden': 'true' }, '›')
      )
    );
  });

  return h('div', { class: 'stack fade-in' },
    h('a', { class: 'back-link', href: '#/' }, '← Accueil'),
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title' }, session.name),
        h('p', { class: 'sub' }, fmtDate(session.date) + ' · ' + players.length + ' joueurs')
      ),
      session.status === 'open'
        ? h('button', {
            class: 'btn btn-outline btn-sm', 'data-testid': 'button-close-session',
            onclick: () => confirmModal({
              title: 'Terminer la session ?',
              message: 'Le classement restera consultable. Vous pourrez rouvrir la session plus tard.',
              confirmLabel: 'Terminer',
              onConfirm: () => { session.status = 'closed'; save(); render(SessionView(session.id)); toast('Session terminée'); },
            }),
          }, 'Terminer')
        : h('div', { class: 'row' },
            h('span', { class: 'badge' }, 'Terminée'),
            h('button', {
              class: 'btn btn-outline btn-sm',
              onclick: () => { session.status = 'open'; save(); render(SessionView(session.id)); },
            }, 'Rouvrir')
          )
    ),
    h('div', { class: 'card' },
      h('h2', { class: 'section-title' }, 'Classement de la soirée'),
      ranking.length
        ? h('div', { class: 'stack' },
            ranking.map((row, i) => h('div', { class: 'rank-row' + (i === 0 ? ' first' : '') },
              h('span', { class: 'rank-pos' }, String(i + 1)),
              playerById[row.pid] ? avatarEl(playerById[row.pid]) : null,
              h('span', { style: 'font-weight:600' }, playerById[row.pid] ? playerById[row.pid].name : '?'),
              h('span', { class: 'rank-pts' }, row.pts + ' pts')
            ))
          )
        : h('p', { class: 'sub' }, 'Aucun Grand Prix validé pour l\u2019instant.')
    ),
    h('div', { class: 'row' },
      h('button', {
        class: 'btn btn-primary', 'data-testid': 'button-new-gp',
        onclick: newGpModal, style: 'flex:1',
      }, 'Nouveau Grand Prix'),
      h('a', { class: 'btn btn-ghost', href: '#/tirage', style: 'flex:1' }, 'Tirage rapide')
    ),
    h('section', {},
      h('h2', { class: 'section-title' }, 'Grands Prix'),
      gpCards.length
        ? h('div', { class: 'stack' }, gpCards)
        : emptyState('Pas encore de Grand Prix', 'Lancez votre premier Grand Prix : les courses seront tirées au sort, puis vous saisirez les positions.', null)
    )
  );
}

function mkToggle(initial, onChange) {
  const el = h('button', {
    class: 'switch' + (initial ? ' on' : ''),
    role: 'switch', 'aria-checked': String(initial),
    onclick: () => {
      const on = !el.classList.contains('on');
      el.classList.toggle('on', on);
      el.setAttribute('aria-checked', String(on));
      onChange(on);
    },
  });
  return el;
}

// ---------- Grand Prix ----------

export function GpView(sessionId, gpId, requestedRaceNum = null) {
  const st = S();
  const session = findSession(sessionId);
  const gp = session && session.grandPrix.find((g) => g.id === gpId);
  if (!gp) return NotFound();

  const players = getPlayers(session.playerIds);
  const complete = gpComplete(gp, session.playerIds.length) && gpConflicts(gp).length === 0;
  const widgets = new Map();
  const ready = (r) => raceComplete(r, session.playerIds.length) && gpConflicts({ races: [r] }).length === 0;
  let nextRace = gp.races.find((r) => !ready(r));
  let activeRaceNum = gp.races.some((r) => r.num === requestedRaceNum) ? requestedRaceNum :
    gp.validated ? null : nextRace?.num || null;
  const progressCount = h('strong');
  const progressState = h('span', { class: 'sub' });
  const progress = h('progress', { max: gp.races.length, value: 0, 'aria-label': 'Progression des courses' });
  const rankBox = h('div', { class: 'gp-podium-stands', 'data-testid': 'gp-live-ranking' });
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
        onclick: () => {
          const standings = gpStandings(gp, players);
          modal({
            title: gp.validated ? 'Classement final du Grand Prix' : 'Classement provisoire du Grand Prix',
            body: h('div', { class: 'stack' },
              h('p', { class: 'sub' }, 'Les points incluent les saisies en cours. Les joueurs à égalité partagent le même rang.'),
              standings.map(({ player, points, rank }) => h('div', { class: 'rank-row' + (rank === 1 ? ' first' : '') },
                h('span', { class: 'rank-pos' }, String(rank)), avatarEl(player),
                h('strong', { class: 'gp-full-rank-name' }, player.name),
                h('span', { class: 'rank-pts' }, points + ' pts')))),
            actions: [{ label: 'Fermer', kind: 'btn-outline', onClick: (close) => close() }],
          });
        },
      }, 'Tout voir')),
    rankBox, route);
  const nextButton = h('button', {
    class: 'btn btn-outline btn-block', 'data-testid': 'button-next-race',
    onclick: () => { if (nextRace) openRace(nextRace.num); },
  });

  const validateBtn = h('button', {
    class: 'btn btn-primary btn-block', 'data-testid': 'button-validate-gp',
    disabled: !complete || gp.validated,
    onclick: () => {
      if (gp.validated) return;
      confirmModal({
        title: 'Valider le Grand Prix ?',
        message: 'Les points seront ajoutés au classement de la soirée. Une correction restera possible ensuite.',
        confirmLabel: 'Valider',
        onConfirm: () => {
          gp.points = gpPoints(gp);
          gp.validated = true;
          gp.validatedAt = Date.now();
          gp.history.push({ date: Date.now(), action: 'validation', note: 'Validé par l\u2019organisateur' });
          save();
          toast('Grand Prix validé — points ajoutés au classement');
          render(GpView(sessionId, gpId));
        },
      });
    },
  }, gp.validated ? 'Grand Prix validé' : 'Valider le Grand Prix');

  function refreshGp() {
    nextRace = gp.races.find((r) => !ready(r));
    const doneCount = gp.races.filter(ready).length;
    progressCount.textContent = doneCount + ' / ' + gp.races.length + ' courses saisies';
    progress.value = doneCount;
    progressState.textContent = gp.validated ? 'Grand Prix validé' :
      nextRace ? 'À renseigner : course ' + nextRace.num : 'Prêt à valider';
    nextButton.hidden = gp.validated || !nextRace || nextRace.num === activeRaceNum;
    nextButton.textContent = nextRace ? 'Reprendre la course ' + nextRace.num : '';
    validateBtn.disabled = gp.validated || !gpComplete(gp, players.length) || gpConflicts(gp).length > 0;
    widgets.forEach((w, num) => {
      const done = ready(w.race), open = num === activeRaceNum;
      w.button.setAttribute('aria-expanded', String(open));
      w.button.setAttribute('aria-current', open ? 'step' : 'false');
      w.button.classList.toggle('done', done);
      w.shell.classList.toggle('is-open', open);
      w.step.classList.toggle('is-done', done);
      w.step.classList.toggle('is-current', open && !gp.validated);
      w.label.textContent = open ? (gp.validated ? 'RÉSULTATS' : 'COURSE OUVERTE') :
        !gp.validated && w.race === nextRace ? 'PROCHAINE COURSE' :
        num === gp.races[0].num ? 'DÉPART' :
        num === gp.races.at(-1).num ? 'DERNIÈRE COURSE' : '';
      w.label.hidden = !w.label.textContent;
      w.badge.textContent = done ? 'Saisie' : open ? 'En cours' : 'À saisir';
      w.badge.className = 'badge ' + (done ? 'badge-ok' : open ? 'badge-primary' : '');
      const stop = routeButtons.get(num);
      stop.classList.toggle('is-done', done);
      stop.classList.toggle('is-current', open);
      stop.setAttribute('aria-current', open ? 'step' : 'false');
      stop.setAttribute('aria-label', 'Course ' + num + ' : ' + w.race.contentName + ', ' +
        raceGame(w.race, gp).name + (done ? ', saisie' : ', à saisir') + (open ? ', ouverte' : ''));
    });
    rankBox.innerHTML = '';
    const standings = gpStandings(gp, players);
    const tied = standings.some((row, index) => index && row.points === standings[index - 1].points);
    const hasResults = gp.races.some((race) => Object.keys(race.results || {}).length);
    podiumCaption.textContent = (gp.validated ? 'Final' : !hasResults ? 'Départ à égalité' : 'Provisoire') +
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
              validateBtn.focus({ preventScroll: true });
              validateBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
      const btn = h('button', {
        class: 'race-item' + (done ? ' done' : ''),
        style: gameStyle(game),
        'data-testid': 'race-' + race.num,
        'aria-controls': panelId, 'aria-expanded': String(next),
        onclick: () => openRace(activeRaceNum === race.num ? null : race.num),
      },
        h('span', { style: 'flex:1;text-align:left;min-width:0' },
          gameBadge(game),
          h('span', { class: 'timeline-course-name' }, race.contentName),
          h('span', { class: 'sub', style: 'font-size:.75rem;display:block' }, race.editionName || 'Jeu de base')
        ),
        h('span', { class: 'gp-race-summary' }, badge,
          h('span', { class: 'gp-expand-mark', 'aria-hidden': 'true' }, '⌄'))
      );
      const shell = h('div', { class: 'gp-race-shell timeline-card', style: gameStyle(game) }, btn, panel);
      const step = timelineStep({
        index, game, previousGame: index ? raceGame(gp.races[index - 1], gp) : null,
        card: shell, label: ' ',
      });
      widgets.set(race.num, { race, button: btn, badge, shell, panel, step, label: step.querySelector('.timeline-label') });
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
      gp.validated
        ? h('span', { class: 'badge badge-ok' }, 'Validé')
        : h('span', { class: 'badge badge-primary' }, 'En cours')
    ),
    h('details', { class: 'gp-game-details' }, h('summary', {}, 'Jeux et éditions'),
      gameLegend(gp.races, gp),
      h('p', { class: 'sub' }, gp.editionNames.join(' · ')))),
    podium,
    h('section', { class: 'gp-chronology', 'aria-label': 'Chronologie et saisie des courses' },
    h('div', { class: 'card stack gp-progress' },
      h('div', { class: 'spread' },
        progressCount, progressState),
      progress, nextButton),
      h('h2', { class: 'section-title' }, 'Course après course'),
      h('p', { class: 'sub gp-unified-help' }, 'Saisis les places sous la course ouverte. Le podium suit en direct.'),
      raceList,
      h('div', { class: 'timeline-finish' }, 'ARRIVÉE · ' + (gp.validated ? 'Grand Prix validé' : 'Validation du Grand Prix'))
    ),
    h('footer', { class: 'stack gp-actions' },
    gp.validated
      ? h('div', { class: 'card' },
          h('div', { class: 'spread' },
            h('strong', {}, 'Corriger ce Grand Prix'),
            h('button', {
              class: 'btn btn-outline btn-sm', 'data-testid': 'button-correct-gp',
              onclick: () => confirmModal({
                title: 'Rouvrir la saisie ?',
                message: 'Le GP repassera en « en cours ». Les points seront recalculés à la prochaine validation ; l\u2019historique gardera une trace de la correction.',
                confirmLabel: 'Rouvrir',
                onConfirm: () => {
                  gp.validated = false;
                  gp.history.push({ date: Date.now(), action: 'correction', note: 'Réouverture pour correction' });
                  save();
                  render(GpView(sessionId, gpId));
                },
              }),
            }, 'Modifier')
          ),
          gp.history.length
            ? h('details', { class: 'accord', style: 'margin-top:12px' },
                h('summary', {}, 'Historique des modifications'),
                h('div', { class: 'accord-body stack' },
                  gp.history.map((hh) => h('div', { class: 'sub' },
                    new Date(hh.date).toLocaleString('fr-FR') + ' — ' + hh.action + ' : ' + hh.note))
                )
              )
            : null
        )
      : null,
    validateBtn,
    !gp.validated
      ? h('button', {
          class: 'btn btn-danger btn-block', 'data-testid': 'button-cancel-gp',
          onclick: () => confirmModal({
            title: 'Annuler ce Grand Prix ?',
            message: 'Il sera définitivement supprimé, sans aucun point au classement.',
            confirmLabel: 'Supprimer', danger: true,
            onConfirm: () => {
              session.grandPrix = session.grandPrix.filter((g) => g.id !== gp.id);
              save();
              toast('Grand Prix annulé');
              location.hash = '#/session/' + sessionId;
            },
          }),
        }, 'Annuler le Grand Prix')
      : null)
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
  const session = findSession(sessionId);
  const gp = session && session.grandPrix.find((g) => g.id === gpId);
  const race = gp && gp.races.find((r) => r.num === raceNum);
  if (!race) return NotFound();

  const players = getPlayers(session.playerIds);
  race.results = race.results || {};
  const controls = new Map();
  const getNext = () => gp.races.find((r) => r.num > race.num &&
    (!raceComplete(r, players.length) || gpConflicts({ races: [r] }).length)) ||
    gp.races.find((r) => r.num !== race.num &&
      (!raceComplete(r, players.length) || gpConflicts({ races: [r] }).length));
  const message = h('p', { class: 'score-feedback sub', role: 'status', 'aria-live': 'polite' });
  const saveBtn = h('button', {
    class: 'btn btn-primary btn-block score-submit', disabled: true,
    'data-testid': 'button-save-scores',
    onclick: () => {
      if (gp.validated || !refreshFeedback()) return;
      if (!flushSave()) {
        toast('Sauvegarde impossible sur cet appareil. Vos saisies restent disponibles dans cet onglet.', 'err');
        return;
      }
      onSaved?.(getNext());
    },
  }, 'Enregistrer');

  function validPlace(raw) {
    return /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) >= 1;
  }
  function refreshFeedback() {
    const counts = new Map();
    players.forEach((p) => {
      const res = race.results[p.id];
      if (res && !res.status && typeof res.pos === 'number')
        counts.set(res.pos, (counts.get(res.pos) || 0) + 1);
    });
    let invalid = 0, clashes = 0, filled = 0;
    controls.forEach((c, pid) => {
      const res = race.results[pid] || {};
      const raw = c.input.value.trim();
      const bad = !res.status && raw !== '' && !validPlace(raw);
      const clash = !res.status && counts.get(res.pos) > 1;
      const error = bad ? 'Saisis un nombre entier à partir de 1.' :
        clash ? 'Place ' + res.pos + ' déjà utilisée.' : '';
      c.input.setAttribute('aria-invalid', String(!!error));
      c.row.classList.toggle('has-error', !!error);
      c.error.textContent = error;
      c.error.hidden = !error;
      c.input.disabled = gp.validated || !!res.status;
      const pts = bad ? null : pointsFor(res, gp.bareme);
      c.points.textContent = pts === null ? '—' : String(pts);
      c.points.classList.toggle('has-points', pts !== null);
      c.status.textContent = res.status
        ? (RACE_STATUSES.find((s) => s.key === res.status)?.label || res.status) + ' · Modifier'
        : 'N’a pas terminé';
      if (bad) invalid++;
      if (clash) clashes++;
      if (res.status || (!bad && typeof res.pos === 'number')) filled++;
    });
    const ready = !invalid && !clashes && filled === players.length;
    saveBtn.disabled = gp.validated || !ready;
    saveBtn.textContent = getNext() ? 'Enregistrer et passer à la suivante' : 'Enregistrer et terminer la saisie';
    message.textContent = gp.validated ? 'Résultats validés. La saisie est verrouillée.' :
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
      disabled: gp.validated || !!res.status,
      'aria-label': 'Place de ' + p.name, 'aria-describedby': errorId,
      'data-testid': 'input-place-' + p.id,
      onfocus: () => input.select(),
      oninput: () => {
        if (gp.validated) return;
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
        const following = [...controls.values()].slice(index + 1).find((c) => !c.input.disabled);
        if (following) following.input.focus();
        else if (!saveBtn.disabled) saveBtn.click();
      },
    });
    const points = h('output', {
      class: 'score-points', 'aria-label': 'Points de ' + p.name,
      'data-testid': 'points-' + p.id,
    });
    const error = h('p', { class: 'score-field-error', id: errorId, hidden: true });
    const status = h('button', {
      class: 'score-status-link', disabled: gp.validated,
      'aria-label': 'Résultat particulier de ' + p.name,
      'data-testid': 'button-score-status-' + p.id,
      onclick: () => {
        const choose = (key) => {
          if (gp.validated) return;
          if (key) race.results[p.id] = { status: key };
          else delete race.results[p.id];
          input.value = '';
          save();
          refreshFeedback();
          onChange?.();
          close();
          if (!key) input.focus();
        };
        const close = modal({
          title: 'Résultat de ' + p.name,
          body: h('div', { class: 'stack' },
            h('p', { class: 'sub' }, 'Ces situations valent 0 point.'),
            RACE_STATUSES.map((s) => h('button', {
              class: 'btn btn-outline btn-block', onclick: () => choose(s.key),
            }, s.label)),
            h('button', { class: 'btn btn-ghost btn-block', onclick: () => choose(null) }, 'Saisir une place')),
          actions: [{ label: 'Annuler' }],
        });
      },
    }, 'N’a pas terminé');
    const row = h('div', { class: 'score-row' },
      h('div', { class: 'score-player' },
        h('div', { class: 'score-player-name' }, avatarEl(p), h('strong', {}, p.name)),
        status),
      input, points, error);
    controls.set(p.id, { row, input, points, status, error });
    return row;
  });
  refreshFeedback();
  const editor = h('div', { class: 'stack score-inline-editor' },
    h('p', { class: 'sub score-inline-hint' }, 'Place réelle dans le jeu, bots compris.'),
    h('section', { class: 'score-sheet', 'aria-label': 'Places et points de la course ' + race.num },
      h('div', { class: 'score-columns', 'aria-hidden': 'true' },
        h('span', {}, 'Joueur'), h('span', {}, 'Place'), h('span', {}, 'Points')),
      ...rows),
    gp.validated ? h('p', { class: 'sub score-feedback' }, 'Résultats validés · saisie verrouillée.')
      : h('div', { class: 'stack score-footer' }, message, saveBtn)
  );
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
