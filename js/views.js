// ============================================================
// Vues principales : accueil, session, Grand Prix, saisie des courses.
// ============================================================

import {
  getState, save, lastSession, findSession, findGame, getPlayers,
  activeGames, gameContents, newId, isPersistent,
} from './store.js';
import { PLAYER_COLORS } from './ui.js';
import {
  h, render, toast, modal, confirmModal, fmtDate, avatarEl,
} from './ui.js';
import {
  drawItems, eligibleItems, raceComplete, gpComplete, gpPoints, gpConflicts,
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

export function GpView(sessionId, gpId) {
  const st = S();
  const session = findSession(sessionId);
  const gp = session && session.grandPrix.find((g) => g.id === gpId);
  if (!gp) return NotFound();

  const players = getPlayers(session.playerIds);
  const complete = gpComplete(gp, session.playerIds.length) && gpConflicts(gp).length === 0;
  const provPoints = gpPoints(gp);
  const rank = Object.entries(provPoints).sort((a, b) => b[1] - a[1]);

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

  const ready = (r) => raceComplete(r, session.playerIds.length) && gpConflicts({ races: [r] }).length === 0;
  const nextRace = gp.races.find((r) => !ready(r));
  const doneCount = gp.races.filter(ready).length;
  const raceList = h('ol', { class: 'race-timeline gp-timeline', 'aria-label': 'Chronologie du Grand Prix' },
    gp.races.map((race, index) => {
      const game = raceGame(race, gp);
      const done = ready(race);
      const next = !gp.validated && race === nextRace;
      const btn = h('button', {
        class: 'race-item timeline-card' + (done ? ' done' : '') + (next ? ' is-next' : ''),
        style: gameStyle(game),
        'data-testid': 'race-' + race.num,
        'aria-current': next ? 'step' : null,
        onclick: () => { location.hash = '#/session/' + sessionId + '/gp/' + gpId + '/course/' + race.num; },
      },
        h('span', { style: 'flex:1;text-align:left;min-width:0' },
          gameBadge(game),
          h('span', { class: 'timeline-course-name' }, race.contentName),
          h('span', { class: 'sub', style: 'font-size:.75rem;display:block' }, race.editionName || 'Jeu de base')
        ),
        done
          ? h('span', { class: 'badge badge-ok' }, 'Saisie')
          : h('span', { class: 'badge' + (next ? ' badge-primary' : '') }, next ? 'Jouer →' : 'À suivre')
      );
      return timelineStep({
        index, game, previousGame: index ? raceGame(gp.races[index - 1], gp) : null,
        card: btn, state: done ? 'is-done' : next ? 'is-current' : '',
        label: next ? 'PROCHAINE COURSE' : index === 0 ? 'DÉPART' : index === gp.races.length - 1 ? 'DERNIÈRE COURSE' : '',
      });
    })
  );

  const view = h('div', { class: 'stack fade-in' },
    h('a', { class: 'back-link', href: '#/session/' + sessionId }, '← ' + session.name),
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title' }, gp.gameIcon + '  ' + gp.gameName),
        h('p', { class: 'sub' }, gp.editionNames.join(' · ') || '\u00a0')
      ),
      gp.validated
        ? h('span', { class: 'badge badge-ok' }, 'Validé')
        : h('span', { class: 'badge badge-primary' }, 'En cours')
    ),
    h('div', { class: 'flag-strip', 'aria-hidden': 'true' }),
    gameLegend(gp.races, gp),
    h('div', { class: 'card stack gp-progress' },
      h('div', { class: 'spread' },
        h('strong', {}, doneCount + ' / ' + gp.races.length + ' courses saisies'),
        h('span', { class: 'sub' }, gp.validated ? 'Grand Prix validé' : nextRace ? 'À jouer : course ' + nextRace.num : 'Prêt à valider')),
      h('progress', { max: gp.races.length, value: doneCount, 'aria-label': 'Progression des courses' }),
      !gp.validated && nextRace ? h('a', {
        class: 'btn btn-primary btn-block', 'data-testid': 'button-next-race',
        href: '#/session/' + sessionId + '/gp/' + gpId + '/course/' + nextRace.num,
      }, 'Jouer la course ' + nextRace.num + ' · ' + nextRace.contentName) : null),
    h('section', {},
      h('h2', { class: 'section-title' }, 'Le déroulé du Grand Prix'),
      raceList,
      h('div', { class: 'timeline-finish' }, 'ARRIVÉE · ' + (gp.validated ? 'Grand Prix validé' : 'Validation du Grand Prix'))
    ),
    h('div', { class: 'card' },
      h('h2', { class: 'section-title' }, 'Points provisoires'),
      rank.length
        ? h('div', { class: 'stack' },
            rank.map(([pid, pts], i) => h('div', { class: 'rank-row' + (i === 0 ? ' first' : '') },
              h('span', { class: 'rank-pos' }, String(i + 1)),
              (() => { const p = players.find((x) => x.id === pid); return p ? avatarEl(p) : null; })(),
              h('span', { style: 'font-weight:600' }, (() => { const p = players.find((x) => x.id === pid); return p ? p.name : '?'; })()),
              h('span', { class: 'rank-pts' }, pts + ' pts')
            ))
          )
        : h('p', { class: 'sub' }, 'Saisissez les premières courses pour voir les points.')
    ),
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
      : null
  );
  return view;
}

// ---------- Saisie d'une course ----------

export function RaceView(sessionId, gpId, raceNum) {
  const st = S();
  const session = findSession(sessionId);
  const gp = session && session.grandPrix.find((g) => g.id === gpId);
  const race = gp && gp.races.find((r) => r.num === raceNum);
  if (!race) return NotFound();

  const players = getPlayers(session.playerIds);
  const n = players.length;
  // Positions saisissables : jusqu'à la longueur du barème (12 par défaut),
  // car les bots du jeu occupent les places entre les joueurs humains.
  const maxPos = Math.max(n, gp.bareme.length);

  function conflicts() {
    const counts = {};
    for (const p of players) {
      const r = race.results[p.id];
      if (r && typeof r.pos === 'number') counts[r.pos] = (counts[r.pos] || 0) + 1;
    }
    return Object.entries(counts).filter(([, c]) => c > 1).map(([p]) => Number(p));
  }

  function build() {
    const rows = players.map((p) => {
      const res = race.results[p.id] || {};
      const pts = pointsFor(res, gp.bareme);
      const taken = new Set(
        players.filter((q) => q.id !== p.id).map((q) => race.results[q.id]).filter((r) => r && typeof r.pos === 'number').map((r) => r.pos)
      );

      const chips = h('div', { class: 'pos-grid' },
        Array.from({ length: maxPos }, (_, i) => i + 1).map((pos) => {
          const sel = res.pos === pos;
          const takenByOther = !sel && taken.has(pos);
          const clash = sel && conflicts().includes(pos);
          const b = h('button', {
            class: 'pos-chip' + (sel ? ' sel' : '') + (clash ? ' sel' : ''),
            'data-testid': 'pos-' + p.name + '-' + pos,
            disabled: gp.validated,
            'aria-label': p.name + ' en position ' + pos,
            style: clash ? 'background:var(--danger);border-color:var(--danger);color:#fff' : null,
            onclick: () => {
              if (race.results[p.id] && race.results[p.id].pos === pos) {
                delete race.results[p.id].pos;
              } else {
                race.results[p.id] = { pos };
              }
              save();
              build();
            },
          }, String(pos));
          if (takenByOther) b.style.opacity = '.5';
          return b;
        })
      );

      const statusSel = h('select', {
        class: 'select', style: 'max-width:140px', 'aria-label': 'Statut de ' + p.name,
        disabled: gp.validated,
      },
        h('option', { value: '' }, 'Statut…'),
        RACE_STATUSES.map((s) => h('option', { value: s.key, selected: res.status === s.key }, s.label))
      );
      statusSel.addEventListener('change', () => {
        if (statusSel.value) race.results[p.id] = { status: statusSel.value };
        else delete race.results[p.id];
        save();
        build();
      });

      return h('div', { class: 'result-row' },
        h('div', { style: 'display:flex;align-items:center;gap:10px;min-width:140px' },
          avatarEl(p), h('strong', {}, p.name)),
        chips,
        statusSel,
        h('span', { class: 'result-pts', style: 'color:' + (pts ? 'var(--gold)' : 'var(--text-faint)') },
          pts === null ? '—' : '+' + pts)
      );
    });

    const cf = conflicts();
    box.innerHTML = '';
    box.append(
      h('div', { class: 'spread', style: 'margin-bottom:6px' },
        h('div', {},
          h('h2', { class: 'section-title', style: 'margin:0' }, 'Course ' + race.num + ' / ' + gp.races.length + ' — ' + race.contentName),
          gameBadge(raceGame(race, gp)),
          h('p', { class: 'sub' },
            race.editionName || 'Jeu de base'
          ),
          h('p', { class: 'sub', style: 'font-size:.75rem' },
            'Places de 1 à ' + maxPos + ' : les bots occupent les places entre les joueurs humains.'
          )
        ),
        raceComplete(race) ? h('span', { class: 'badge badge-ok' }, 'Complète') : h('span', { class: 'badge' }, 'Saisie en cours')
      ),
      ...rows
    );
    if (cf.length) {
      box.append(h('div', { class: 'warn-banner' },
        h('div', {}, 'Position' + (cf.length > 1 ? 's' : '') + ' ' + cf.join(', ') + ' attribuée' + (cf.length > 1 ? 's' : '') + ' à plusieurs joueurs : corrigez pour valider le GP.')
      ));
    }
    if (!gp.validated && raceComplete(race, players.length) && !cf.length) {
      const next = gp.races.find((r) => r.num > race.num &&
        (!raceComplete(r, players.length) || gpConflicts({ races: [r] }).length));
      box.append(h('div', { class: 'card stack race-next' },
        h('strong', {}, next ? 'Ensuite : course ' + next.num : 'Course saisie'),
        next ? gameBadge(raceGame(next, gp)) : null,
        h('a', {
          class: 'btn btn-primary btn-block', 'data-testid': 'button-continue-race',
          href: '#/session/' + sessionId + '/gp/' + gpId + (next ? '/course/' + next.num : ''),
        }, next ? 'Continuer · ' + next.contentName : 'Revenir au bilan du Grand Prix')));
    }
  }

  const box = h('div', { class: 'stack' });
  build();

  return h('div', { class: 'stack fade-in' },
    h('a', { class: 'back-link', href: '#/session/' + sessionId + '/gp/' + gpId }, '← Grand Prix'),
    gp.validated
      ? h('div', { class: 'warn-banner' }, h('div', {}, 'Grand Prix validé : la saisie est verrouillée. Utilisez « Modifier » sur la page du GP pour corriger.'))
      : null,
    h('div', { class: 'card stack' }, box),
    h('a', { class: 'btn btn-ghost btn-block', href: '#/session/' + sessionId + '/gp/' + gpId }, 'Retour au Grand Prix')
  );
}

// ---------- 404 ----------

export function NotFound() {
  return h('div', { class: 'stack fade-in' },
    h('h1', { class: 'page-title' }, 'Page introuvable'),
    h('p', { class: 'sub' }, 'Cette page n\u2019existe pas ou a été supprimée.'),
    h('a', { class: 'btn btn-primary', href: '#/' }, 'Retour à l\u2019accueil')
  );
}
