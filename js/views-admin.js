// ============================================================
// Vues secondaires : tirage rapide, bibliothèque de jeux,
// classements, réglages.
// ============================================================

import {
  getState, save, flushSave, findGame, findSession, newId, activeGames, gameContents,
  exportJSON, importJSON, resetAll, isPersistent, previousBackup,
} from './store.js';
import { h, render, toast, modal, confirmModal, fmtDateTime, download, readFile, avatarEl } from './ui.js';
import { drawItems, eligibleItems, sessionRanking, allTimeStats, RACE_STATUSES } from './engine.js';
import { NotFound, HomeView, buildGpFromItems } from './views.js';
import { setPendingDraw } from './pending.js';
import { raceGame, gameStyle, gameBadge, gameLegend, timelineStep } from './race-visuals.js';
import { APP_VERSION } from './updates.js';

const S = () => getState();
const pl = (n, word) => n + ' ' + word + (n > 1 ? 's' : '');

// ---------- Tirage rapide ----------

export function TirageView(sessionId = null) {
  const st = S();
  const targetSession = sessionId ? findSession(sessionId) : null;
  if (sessionId && !targetSession) return NotFound();
  const games = activeGames();
  if (!games.length) {
    return h('div', { class: 'stack fade-in' },
      h('h1', { class: 'page-title' }, 'Tirage rapide'),
      h('div', { class: 'card empty-state' },
        h('h3', {}, 'Aucun jeu disponible'),
        h('p', {}, 'Ajoutez un jeu et ses contenus pour lancer un tirage.'),
        h('a', { class: 'btn btn-primary', href: '#/jeux' }, 'Bibliothèque de jeux')
      )
    );
  }

  // Multi-jeux : le tirage peut mélanger les contenus de plusieurs jeux.
  const prefs = st.settings.drawPreferences || {};
  const remembered = (prefs.gameIds || []).filter((id) => games.some((g) => g.id === id));
  const selectedGames = new Set(remembered.length ? remembered : games.map((g) => g.id));
  const editionsByGame = new Map(games.map((g) => [g.id,
    new Set((prefs.editionIds && Array.isArray(prefs.editionIds[g.id])
      ? prefs.editionIds[g.id] : g.editions.filter((e) => e.active).map((e) => e.id))
      .filter((id) => g.editions.some((ed) => ed.id === id))) ]));
  let count = Math.max(1, Math.min(24, Number(prefs.count) || 4));
  let unique = prefs.unique !== false;
  let excludeRecent = prefs.excludeRecent === true;
  let lockedIds = [];
  let currentItems = [];
  const configBody = h('div', { class: 'stack' });
  const configSummary = h('p', { class: 'sub draw-config-summary' });
  const editBtn = h('button', {
    class: 'btn btn-outline btn-sm', style: 'display:none',
    'data-testid': 'button-edit-draw',
    onclick: () => {
      configBody.hidden = !configBody.hidden;
      editBtn.textContent = configBody.hidden ? 'Modifier' : 'Replier';
    },
  }, 'Modifier');
  function remember() {
    st.settings.drawPreferences = {
      gameIds: [...selectedGames], editionIds: Object.fromEntries(
        [...editionsByGame].map(([id, ids]) => [id, [...ids]])),
      count, unique, excludeRecent,
    };
    save();
  }
  function changed() {
    lockedIds = []; currentItems = [];
    remember(); refreshInfo(); drawResults();
    configBody.hidden = false;
    editBtn.style.display = 'none';
  }

  const gamesBox = h('div', { class: 'draw-games' });
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
        refreshGames(); refreshEditions(); changed();
      });
      const n = eligibleItems(gameContents(g, [...editionsByGame.get(g.id)]), {}).length;
      gamesBox.append(h('label', { class: 'draw-game' + (cb.checked ? ' selected' : '') }, cb,
        h('span', { class: 'content-name' }, gameBadge({ id: g.id, name: g.name })),
        h('span', { class: 'sub' }, n + ' circuits')
      ));
    });
  }
  function refreshEditions() {
    editionsBox.innerHTML = '';
    const sel = games.filter((g) => selectedGames.has(g.id));
    sel.forEach((g) => {
      editionsBox.append(h('div', { class: 'field-label' }, g.name));
      const chooseEditions = (baseOnly) => {
        editionsByGame.set(g.id, new Set(g.editions.filter((ed) =>
          baseOnly ? !ed.dlc && ed.active : ed.active).map((ed) => ed.id)));
        refreshGames(); refreshEditions(); changed();
      };
      editionsBox.append(h('div', { class: 'row' },
        h('button', { class: 'btn btn-outline btn-sm', onclick: () => chooseEditions(true) }, 'Jeu de base'),
        h('button', { class: 'btn btn-outline btn-sm', onclick: () => chooseEditions(false) }, 'Tout inclure')));
      g.editions.forEach((ed) => {
        const cb = h('input', { type: 'checkbox' });
        cb.checked = editionsByGame.get(g.id).has(ed.id);
        cb.addEventListener('change', () => {
          if (cb.checked) editionsByGame.get(g.id).add(ed.id);
          else editionsByGame.get(g.id).delete(ed.id);
          refreshGames(); changed();
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
    class: 'input', type: 'number', min: 1, max: 24, value: count,
    style: 'width:80px', 'aria-label': 'Nombre de courses', 'data-testid': 'input-draw-count',
  });
  countInput.addEventListener('input', () => {
    count = Math.max(1, Math.min(24, parseInt(countInput.value, 10) || 4));
    countInput.value = count;
    refreshPresets(); changed();
  });
  const countPresets = h('div', { class: 'draw-count-presets', role: 'group', 'aria-label': 'Nombre de courses' });
  function refreshPresets() {
    countPresets.innerHTML = '';
    [2, 4, 6, 8].forEach((n) => countPresets.append(h('button', {
      class: 'btn btn-sm ' + (n === count ? 'btn-primary' : 'btn-outline'),
      'aria-pressed': String(n === count),
      onclick: () => { count = n; countInput.value = n; refreshPresets(); changed(); },
    }, String(n))));
  }
  refreshPresets();

  const infoBox = h('p', { class: 'sub', role: 'status', 'aria-live': 'polite' });
  const drawBtn = h('button', { class: 'btn btn-primary btn-block', 'data-testid': 'button-draw' }, 'Tirer au sort');
  const rerollBtn = h('button', { class: 'btn btn-outline btn-sm', 'data-testid': 'button-reroll' }, 'Relancer les courses libres');
  const resultsBox = h('div', { class: 'draw-results' });
  const legendBox = h('div');
  const resultsTitle = h('h2', { class: 'section-title', style: 'margin:0', tabindex: '-1' }, 'Votre grille de départ');
  const resultsHint = h('p', { class: 'sub' });

  function usedContentIds() {
    // Contenus déjà tirés lors des 5 derniers tirages enregistrés.
    const ids = new Set();
    if (targetSession) {
      targetSession.grandPrix.forEach(gp => gp.races.forEach(r => { if (r.contentId) ids.add(r.contentId); }));
      return ids;
    }
    const draws = [...(st.draws || []), ...st.sessions.flatMap((s) => s.draws || [])]
      .sort((a, b) => a.date - b.date).slice(-5);
    for (const d of draws) {
      for (const cid of d.contentIds || []) ids.add(cid);
    }
    return ids;
  }

  function refreshInfo() {
    const eligible = eligibleItems(currentPool(), { excludeIds: excludeRecent ? [...usedContentIds()] : [] });
    configSummary.textContent = count + ' courses · ' + selectedGames.size + ' jeu(x) · ' +
      (unique ? 'Sans doublon' : 'Doublons autorisés');
    drawBtn.textContent = 'Tirer ' + count + ' courses';
    if (!eligible.length) {
      infoBox.textContent = 'Aucun contenu éligible — activez des éditions ou vérifiez la bibliothèque.';
      drawBtn.disabled = true;
    } else if (unique && eligible.length < count) {
      infoBox.textContent = 'Seulement ' + eligible.length + ' contenus éligibles pour ' + count + ' tirages sans doublon : réduisez le nombre, élargissez les éditions ou autorisez les doublons.';
      drawBtn.disabled = true;
    } else {
      infoBox.textContent = eligible.length + ' contenus éligibles';
      drawBtn.disabled = false;
    }
  }

  function doDraw(keepLocked) {
    const recent = excludeRecent ? [...usedContentIds()].filter((id) => !lockedIds.includes(id)) : [];
    const eligible = eligibleItems(currentPool(), { excludeIds: recent });
    const res = drawItems(eligible, { count, unique, lockedIds: keepLocked ? lockedIds : [] });
    if (res.error) {
      infoBox.textContent = 'Pas assez de courses disponibles. Élargissez les éditions ou désactivez l’exclusion des tirages récents.';
      configBody.hidden = false;
      return;
    }
    if (keepLocked) {
      const unlocked = res.items.filter((c) => !lockedIds.includes(c.id));
      currentItems = currentItems.map((c) => lockedIds.includes(c.id) ? c : unlocked.shift());
    } else currentItems = res.items;
    if (!keepLocked) lockedIds = [];
    drawResults();
    configBody.hidden = true; editBtn.style.display = ''; editBtn.textContent = 'Modifier';
    resultsTitle.focus({ preventScroll: true });
    const headingBounds = resultsTitle.getBoundingClientRect();
    if (headingBounds.top < 80 || headingBounds.bottom > innerHeight) {
      resultsTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    // Historique des tirages (attaché à la session ouverte, sinon global)
    {
      const sess = targetSession || st.sessions.filter((s) => s.status === 'open').slice(-1)[0];
      const gameNames = [...new Set(res.items.map((c) => c.gameName).filter(Boolean))];
      const entry = {
        date: Date.now(), gameId: gameNames.length === 1 ? res.items[0].gameId : 'multi',
        gameName: gameNames.length === 1 ? gameNames[0] : 'Multi-jeux',
        contentIds: res.items.map((c) => c.id), names: res.items.map((c) => c.name),
      };
      if (sess) (sess.draws ||= []).push(entry);
      else st.draws = [...(st.draws || []), entry];
      save();
    }
  }
  function rerollOne(index) {
    const old = currentItems[index];
    const exclude = new Set(excludeRecent ? usedContentIds() : []);
    if (unique) currentItems.forEach((c) => exclude.add(c.id));
    exclude.add(old.id);
    const res = drawItems(eligibleItems(currentPool(), { excludeIds: [...exclude] }), { count: 1, unique: true });
    if (res.error) { toast('Aucune autre course disponible avec ces filtres', 'err'); return; }
    currentItems[index] = res.items[0];
    drawResults();
  }

  function drawResults() {
    resultsBox.innerHTML = '';
    legendBox.innerHTML = '';
    rerollBtn.style.display = currentItems.length ? '' : 'none';
    rerollBtn.disabled = currentItems.length > 0 && currentItems.every((c) => lockedIds.includes(c.id));
    resultsHint.textContent = currentItems.length
      ? '« Garder » protège une course. « Changer » ne remplace que celle-ci.'
      : 'Votre sélection apparaîtra ici. Choisissez vos jeux, puis lancez le tirage.';
    actionsBox.innerHTML = '';
    if (!currentItems.length) {
      resultsBox.append(h('div', { class: 'draw-empty' },
        h('span', { class: 'draw-empty-count' }, String(count)),
        h('strong', {}, 'courses à découvrir'),
        h('p', { class: 'sub' }, 'Un tirage, puis à vous de jouer.')));
      return;
    }
    legendBox.append(gameLegend(currentItems));
    const timeline = h('ol', { class: 'race-timeline', 'aria-label': 'Ordre des courses tirées' });
    resultsBox.append(timeline);
    currentItems.forEach((c, index) => {
      const game = raceGame(c);
      const locked = lockedIds.includes(c.id);
      const lockBtn = h('button', {
        class: 'lock-btn' + (locked ? ' on' : ''),
        'aria-label': locked ? 'Déverrouiller ' + c.name : 'Verrouiller ' + c.name,
        'aria-pressed': String(locked),
        onclick: () => {
          if (lockedIds.includes(c.id)) lockedIds = lockedIds.filter((x) => x !== c.id);
          else lockedIds.push(c.id);
          drawResults();
        },
      }, locked ? 'Gardée' : 'Garder');
      const card = h('div', {
        class: 'draw-course draw-card timeline-card' + (locked ? ' is-locked' : ''),
        style: gameStyle(game),
      },
        h('div', { class: 'draw-course-copy' },
          gameBadge(game),
          h('div', { class: 'draw-name' }, c.name),
          h('div', { class: 'sub' }, c.editionName || 'Jeu de base'),
          c.status === 'unverified' ? h('span', { class: 'badge badge-warn' }, 'À vérifier') : null),
        h('div', { class: 'draw-course-tools' }, lockBtn,
          h('button', {
            class: 'btn btn-ghost btn-sm', disabled: locked,
            'aria-label': 'Remplacer ' + c.name, 'data-testid': 'reroll-course-' + index,
            onclick: () => rerollOne(index),
          }, 'Changer'))
      );
      timeline.append(timelineStep({
        index, game, previousGame: index ? raceGame(currentItems[index - 1]) : null,
        card, label: index === 0 ? 'DÉPART' : index === currentItems.length - 1 ? 'DERNIÈRE COURSE' : '',
      }));
    });
    resultsBox.append(h('div', { class: 'timeline-finish' }, 'ARRIVÉE · ' + currentItems.length + ' courses'));

    // Actions : lancer un Grand Prix avec ce tirage.
    if (targetSession) {
      actionsBox.append(h('p', { class: 'sub' }, targetSession.name + ' · ' + targetSession.playerIds.length + ' joueurs'),
        h('button', {
          class: 'btn btn-primary btn-block', 'data-testid': 'button-gp-in-session',
          disabled: targetSession.playerIds.length < 2 || targetSession.status !== 'open',
          onclick: () => {
            const gp = buildGpFromItems(st, currentItems);
            targetSession.grandPrix.push(gp);
            save();
            if (!flushSave()) return;
            location.hash = '#/session/' + targetSession.id + '/gp/' + gp.id;
          },
        }, 'Lancer ces ' + currentItems.length + ' courses'));
      if (targetSession.status !== 'open') actionsBox.append(h('p', { class: 'sub' }, 'Rouvrez cette session avant de lancer un Grand Prix.'));
      return;
    }
    const openSessions = st.sessions.filter((s) => s.status === 'open');
    const validSessions = openSessions.filter((s) => s.playerIds.length >= 2);
    const latest = validSessions.slice(-1)[0];
    if (latest) {
      const sessionSelect = h('select', {
        class: 'select', 'aria-label': 'Session pour ce Grand Prix', 'data-testid': 'select-draw-session',
      }, validSessions.map((s) => h('option', { value: s.id, selected: s.id === latest.id }, s.name)));
      actionsBox.append(h('label', { class: 'field' },
        h('span', { class: 'field-label' }, 'Jouer dans la session'), sessionSelect));
      actionsBox.append(h('button', {
        class: 'btn btn-primary btn-block', 'data-testid': 'button-gp-in-session',
        onclick: () => {
          const chosen = validSessions.find((s) => s.id === sessionSelect.value);
          const gp = buildGpFromItems(st, currentItems);
          chosen.grandPrix.push(gp);
          save();
          if (!flushSave()) return;
          toast('Grand Prix ajouté à « ' + chosen.name + ' »');
          location.hash = '#/session/' + chosen.id + '/gp/' + gp.id;
        },
      }, 'Lancer le Grand Prix'));
    }
    actionsBox.append(h('button', {
      class: 'btn ' + (latest ? 'btn-ghost' : 'btn-primary') + ' btn-block', 'data-testid': 'button-new-session-draw',
      onclick: () => {
        setPendingDraw(currentItems);
        location.hash = '#/nouvelle-session';
      },
    }, latest ? 'Créer une autre session' : 'Créer la session et jouer'));
  }

  const actionsBox = h('div', { class: 'stack' });

  drawBtn.addEventListener('click', () => doDraw(false));
  rerollBtn.addEventListener('click', () => doDraw(true));

  const uniqueToggle = mkToggle2(unique, (v) => { unique = v; changed(); });
  uniqueToggle.setAttribute('aria-label', 'Sans doublon');
  const recentToggle = mkToggle2(excludeRecent, (v) => { excludeRecent = v; changed(); });
  recentToggle.setAttribute('aria-label', targetSession ? 'Éviter les circuits déjà joués dans cette session' : 'Éviter les cinq derniers tirages');

  refreshGames();
  refreshEditions();
  refreshInfo();
  drawResults();

  configBody.append(
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Choisir les jeux'), gamesBox),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Nombre de courses'),
      h('div', { class: 'row draw-count' }, countPresets, countInput)),
    h('details', { class: 'draw-options' },
      h('summary', {}, 'Éditions, DLC et options'),
      h('div', { class: 'stack' }, editionsBox,
        h('div', { class: 'spread' }, h('span', {}, 'Sans doublon'), uniqueToggle),
        h('div', { class: 'spread' }, h('span', {}, targetSession ? 'Éviter les circuits déjà joués' : 'Éviter les 5 derniers tirages'), recentToggle))),
    infoBox, drawBtn);

  return h('div', { class: 'stack fade-in draw-page' },
    targetSession ? h('a', { class: 'back-link', href: '#/session/' + targetSession.id }, '← ' + targetSession.name) : null,
    h('h1', { class: 'page-title' }, targetSession ? 'Préparer le Grand Prix' : 'Tirage rapide'),
    h('p', { class: 'sub' }, targetSession ? 'Choisissez vos jeux, vérifiez les courses, puis lancez le Grand Prix.' : 'Choisissez. Tirez. Jouez.'),
    targetSession ? h('ol', { class: 'journey-steps', 'aria-label': 'Étapes du Grand Prix' },
      h('li', {}, '1 · Joueurs prêts'), h('li', { 'aria-current': 'step' }, '2 · Choisir les courses'), h('li', {}, '3 · Jouer et saisir')) : null,
    h('div', { class: 'draw-layout' },
      h('section', { class: 'card card-pad-lg stack draw-config', 'aria-label': 'Réglages du tirage' },
        h('div', { class: 'spread' }, h('h2', { class: 'section-title', style: 'margin:0' }, 'Votre sélection'), editBtn),
        configSummary, configBody),
      h('section', { class: 'card card-pad-lg stack draw-output', 'aria-label': 'Résultat du tirage' },
        h('div', { class: 'spread' }, resultsTitle, rerollBtn),
        resultsHint,
        h('div', { class: 'draw-launch stack' }, actionsBox),
        legendBox, resultsBox))
  );
}

function mkToggle2(initial, onChange) {
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

// ---------- Bibliothèque de jeux ----------

const STATUS_BADGES = {
  verified: ['Vérifié', 'badge-ok'],
  unverified: ['À vérifier', 'badge-warn'],
  draft: ['Brouillon', ''],
  archived: ['Archivé', ''],
};

export function JeuxView() {
  const st = S();
  const games = st.games;

  function addGameModal() {
    const f = {
      name: h('input', { class: 'input', type: 'text', placeholder: 'Ex. : Mario Party', 'data-testid': 'input-game-name' }),
      icon: h('input', { class: 'input', type: 'text', placeholder: '🎮', maxlength: 4, style: 'max-width:90px' }),
      platform: h('input', { class: 'input', type: 'text', placeholder: 'Ex. : Nintendo Switch' }),
      genre: h('input', { class: 'input', type: 'text', placeholder: 'Ex. : Party game' }),
      contentType: h('input', { class: 'input', type: 'text', placeholder: 'Ex. : Manche, Carte, Niveau…', value: 'Circuit' }),
    };
    const editionName = h('input', { class: 'input', type: 'text', value: 'Jeu de base' });
    modal({
      title: 'Nouveau jeu',
      body: h('div', { class: 'stack' },
        h('div', { class: 'row' },
          h('label', { class: 'field', style: 'flex:1' }, h('span', { class: 'field-label' }, 'Nom du jeu'), f.name),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Icône'), f.icon)
        ),
        h('div', { class: 'row' },
          h('label', { class: 'field', style: 'flex:1' }, h('span', { class: 'field-label' }, 'Plateforme'), f.platform),
          h('label', { class: 'field', style: 'flex:1' }, h('span', { class: 'field-label' }, 'Genre'), f.genre)
        ),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Type de contenu à tirer'), f.contentType),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Première édition / liste'), editionName)
      ),
      actions: [
        { label: 'Annuler' },
        {
          label: 'Créer', kind: 'btn-primary', testid: 'button-create-game',
          onClick: (close) => {
            const name = f.name.value.trim();
            if (name.length < 2) { toast('Le nom du jeu est requis', 'err'); return; }
            const game = {
              id: newId('g'), name, icon: f.icon.value.trim() || '🎮',
              platform: f.platform.value.trim(), genre: f.genre.value.trim(),
              contentType: f.contentType.value.trim() || 'Contenu',
              archived: false, createdAt: Date.now(),
              editions: [{
                id: newId('e'), name: editionName.value.trim() || 'Jeu de base',
                dlc: false, active: true, contents: [],
              }],
            };
            st.games.push(game);
            save();
            close();
            toast('Jeu créé');
            location.hash = '#/jeux/' + game.id;
          },
        },
      ],
    });
  }

  return h('div', { class: 'stack fade-in' },
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title' }, 'Bibliothèque de jeux'),
        h('p', { class: 'sub' }, 'Tout est modifiable : ajoutez vos jeux, éditions et contenus.')
      )
    ),
    h('button', { class: 'btn btn-primary', 'data-testid': 'button-add-game', onclick: addGameModal }, '+ Ajouter un jeu'),
    h('div', { class: 'stack' },
      games.map((g) => {
        const total = g.editions.reduce((n, e) => n + e.contents.length, 0);
        return h('a', {
          class: 'card card-click', href: '#/jeux/' + g.id,
          style: 'display:block;text-decoration:none', 'data-testid': 'card-game-' + g.id,
        },
          h('div', { class: 'spread' },
            h('div', { class: 'row' },
              h('span', { style: 'font-size:1.6rem' }, g.icon),
              h('div', {},
                h('strong', {}, g.name),
                g.archived ? h('span', { class: 'badge', style: 'margin-left:8px' }, 'Archivé') : null,
                h('div', { class: 'sub' }, [g.platform, g.genre].filter(Boolean).join(' · '))
              )
            ),
            h('div', { style: 'text-align:right' },
              h('span', { class: 'badge badge-primary' }, total + ' contenus'),
              h('div', { class: 'sub', style: 'font-size:.78rem' }, g.editions.length + ' éditions')
            )
          )
        );
      })
    )
  );
}

export function GameView(gameId, { importing = false } = {}) {
  const st = S();
  const game = findGame(gameId);
  if (!game) return NotFound();

  function saveGame() { save(); render(GameView(gameId)); }

  function manageContentsModal(edition) {
    const selected = new Set();
    const search = h('input', {
      class: 'input', type: 'search', placeholder: 'Rechercher un circuit…',
      'aria-label': 'Rechercher un circuit', 'data-testid': 'input-manage-search',
    });
    const list = h('div', { class: 'stack' });
    const count = h('p', { class: 'sub', role: 'status', 'aria-live': 'polite' });
    const visibleItems = () => edition.contents.filter((c) =>
      c.status !== 'archived' && c.name.toLocaleLowerCase('fr').includes(search.value.trim().toLocaleLowerCase('fr')));
    const removeBtn = h('button', {
      class: 'btn btn-danger btn-block', disabled: true,
      'data-testid': 'button-remove-selected',
      onclick: () => {
        const items = edition.contents.filter((c) => selected.has(c.id));
        if (!items.length) return;
        const usedIds = new Set(st.sessions.flatMap((s) =>
          s.grandPrix.flatMap((g) => g.races.map((r) => r.contentId))));
        const used = items.filter((c) => usedIds.has(c.id));
        close();
        confirmModal({
          title: 'Supprimer les circuits sélectionnés ?',
          message: items.length + ' circuit(s) sélectionné(s) : ' +
            items.slice(0, 8).map((c) => c.name).join(', ') +
            (items.length > 8 ? ', …' : '') + '. ' +
            (used.length ? used.length + ' déjà utilisé(s) seront archivés et exclus des tirages pour préserver les résultats. ' : '') +
            'Les autres seront supprimés définitivement.',
          confirmLabel: 'Confirmer la suppression', danger: true,
          onConfirm: () => {
            edition.contents = edition.contents.filter((c) => {
              if (!selected.has(c.id)) return true;
              if (usedIds.has(c.id)) { c.status = 'archived'; c.active = false; return true; }
              return false;
            });
            saveGame();
            toast((items.length - used.length) + ' supprimé(s)' +
              (used.length ? ' · ' + used.length + ' archivé(s)' : ''));
          },
        });
      },
    }, 'Supprimer la sélection');
    function updateCount() {
      count.textContent = selected.size + ' circuit(s) sélectionné(s)';
      removeBtn.disabled = selected.size === 0;
    }
    function refreshList() {
      list.innerHTML = '';
      const items = visibleItems();
      if (!items.length) list.append(h('p', { class: 'sub' }, 'Aucun circuit correspondant.'));
      items.forEach((c) => {
        const cb = h('input', {
          type: 'checkbox', checked: selected.has(c.id),
          'data-testid': 'select-content-' + c.id,
          onchange: () => {
            if (cb.checked) selected.add(c.id); else selected.delete(c.id);
            updateCount();
          },
        });
        list.append(h('label', { class: 'content-row', style: 'cursor:pointer' },
          cb, h('span', { class: 'content-name' }, c.name)));
      });
      updateCount();
    }
    search.addEventListener('input', refreshList);
    const close = modal({
      title: 'Supprimer des circuits — ' + edition.name,
      body: h('div', { class: 'stack' },
        h('p', { class: 'sub' }, 'Cochez les circuits incorrects. Rien ne sera modifié avant confirmation.'),
        search,
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-outline btn-sm', onclick: () => {
            visibleItems().forEach((c) => selected.add(c.id)); refreshList();
          } }, 'Tout sélectionner (filtre)'),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
            selected.clear(); refreshList();
          } }, 'Tout désélectionner')),
        count, list, removeBtn),
      actions: [{ label: 'Annuler' }],
    });
    refreshList();
  }

  function editGameModal() {
    const f = {
      name: h('input', { class: 'input', type: 'text', value: game.name }),
      icon: h('input', { class: 'input', type: 'text', value: game.icon, maxlength: 4, style: 'max-width:90px' }),
      platform: h('input', { class: 'input', type: 'text', value: game.platform }),
      genre: h('input', { class: 'input', type: 'text', value: game.genre }),
      contentType: h('input', { class: 'input', type: 'text', value: game.contentType }),
    };
    modal({
      title: 'Modifier le jeu',
      body: h('div', { class: 'stack' },
        h('div', { class: 'row' },
          h('label', { class: 'field', style: 'flex:1' }, h('span', { class: 'field-label' }, 'Nom'), f.name),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Icône'), f.icon)
        ),
        h('div', { class: 'row' },
          h('label', { class: 'field', style: 'flex:1' }, h('span', { class: 'field-label' }, 'Plateforme'), f.platform),
          h('label', { class: 'field', style: 'flex:1' }, h('span', { class: 'field-label' }, 'Genre'), f.genre)
        ),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Type de contenu'), f.contentType)
      ),
      actions: [
        { label: 'Annuler' },
        {
          label: 'Enregistrer', kind: 'btn-primary',
          onClick: (close) => {
            game.name = f.name.value.trim() || game.name;
            game.icon = f.icon.value.trim() || game.icon;
            game.platform = f.platform.value.trim();
            game.genre = f.genre.value.trim();
            game.contentType = f.contentType.value.trim() || 'Contenu';
            saveGame();
            close();
            toast('Jeu mis à jour');
          },
        },
      ],
    });
  }

  function addContentsModal(edition) {
    const single = h('input', { class: 'input', type: 'text', placeholder: 'Nom du contenu' });
    const bulk = h('textarea', {
      class: 'textarea', placeholder: 'Ou collez une liste, un nom par ligne.\nLes doublons existants seront signalés.',
    });
    modal({
      title: 'Ajouter des contenus — ' + edition.name,
      body: h('div', { class: 'stack' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Ajout unitaire'), single),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Ajout en bloc'), bulk)
      ),
      actions: [
        { label: 'Annuler' },
        {
          label: 'Ajouter', kind: 'btn-primary', testid: 'button-add-contents',
          onClick: (close) => {
            const names = new Set();
            if (single.value.trim()) names.add(single.value.trim());
            for (const line of bulk.value.split('\n')) {
              const t = line.trim();
              if (t) names.add(t);
            }
            const existing = new Set(edition.contents.map((c) => c.name.toLowerCase()));
            let added = 0, dup = 0;
            for (const name of names) {
              if (existing.has(name.toLowerCase())) { dup++; continue; }
              edition.contents.push({ id: newId('c'), name, tags: [], status: 'verified', active: true, source: 'Saisi manuellement' });
              added++;
            }
            saveGame();
            close();
            toast(added + ' contenu(s) ajouté(s)' + (dup ? ' · ' + dup + ' doublon(s) ignoré(s)' : ''));
          },
        },
      ],
    });
  }

  function importPage() {
    // Import en masse : liste collée, fichier (txt/csv/json) ou recherche IA.
    // Les sections « == Nom == » ou « # Nom » découpent la liste en éditions
    // (ex. jeu de base vs DLC) : chaque édition est ensuite activable
    // indépendamment dans les tirages.
    let mode = 'liste';

    const tabBtns = h('div', { class: 'row', role: 'group', 'aria-label': 'Méthode d’import', style: 'flex-wrap:wrap;gap:8px' });
    const panes = { liste: h('div', { class: 'stack' }), fichier: h('div', { class: 'stack' }), ia: h('div', { class: 'stack' }) };

    const ta = h('textarea', {
      class: 'textarea', rows: 8, 'data-testid': 'textarea-import',
      'aria-label': 'Liste des circuits',
      placeholder: 'Un circuit par ligne.\n\nPour découper la liste en éditions (ex. jeu de base / DLC), commencez un groupe par une ligne :\n== Jeu de base ==\n== Pass circuits ==\n\nLa numérotation (1. 2. 3.) est retirée automatiquement.',
    });
    ta.addEventListener('input', refresh);

    const fileInput = h('input', {
      type: 'file', class: 'input', 'data-testid': 'input-import-file',
      accept: '.txt,.csv,.json,text/plain,text/csv,application/json',
    });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      try {
        let text = await readFile(file);
        if (/\.json$/i.test(file.name)) {
          const data = JSON.parse(text);
          const lines = [];
          const emit = (arr) => arr.forEach((x) => {
            const name = typeof x === 'string' ? x : (x.name || x.nom || x.circuit || x.title);
            if (name) lines.push(String(name));
          });
          if (Array.isArray(data)) {
            const withEd = data.filter((x) => x && typeof x === 'object' && Array.isArray(x.editions));
            if (withEd.length) {
              withEd.forEach((g) => {
                if (g.name) lines.push('== ' + g.name + ' ==');
                emit(g.editions || []);
                if (g.contents) emit(g.contents);
              });
            } else emit(data);
          } else if (data && Array.isArray(data.editions)) {
            data.editions.forEach((ed) => {
              if (ed.name) lines.push('== ' + ed.name + ' ==');
              emit(ed.contents || []);
            });
          } else if (data && Array.isArray(data.contents)) {
            emit(data.contents);
          }
          text = lines.join('\n');
        } else if (/\.csv$/i.test(file.name)) {
          text = text.split(/\r?\n/).map((l) => {
            const cells = l.split(/[;,]/);
            return (cells[0] || '').replace(/^["']|["']$/g, '').trim();
          }).filter(Boolean).join('\n');
        }
        ta.value = text;
        setMode('liste');
        refresh();
        toast('Fichier chargé : ' + file.name);
      } catch (e) {
        toast('Fichier illisible (txt, csv ou json attendu)', 'err');
      }
      fileInput.value = '';
    });

    // ---- Onglet IA : prompt pré-construit ----
    const aiGame = h('input', { class: 'input', type: 'text', value: game.name, 'aria-label': 'Nom du jeu' });
    const aiPlatform = h('input', { class: 'input', type: 'text', value: game.platform || '', 'aria-label': 'Plateforme' });
    const aiPrompt = h('textarea', { class: 'textarea', rows: 10, readonly: 'readonly', 'data-testid': 'textarea-ai-prompt' });
    function buildPrompt() {
      const p = aiPlatform.value.trim() ? ' (' + aiPlatform.value.trim() + ')' : '';
      aiPrompt.value =
        'Liste-moi TOUS les circuits de « ' + (aiGame.value.trim() || game.name) + ' »' + p + ' : jeu de base, DLC et mises à jour inclus, dans l\u2019ordre officiel, avec les noms français exacts.\n\n' +
        'Format attendu (pour import dans une application, respecte-le exactement) :\n' +
        '- une ligne « == Nom de l\u2019édition == » au début de chaque groupe (ex. « == Jeu de base == », « == Pass circuits == », « == Mise à jour X == ») ;\n' +
        '- puis un circuit par ligne, sans numérotation ni ponctuation ;\n' +
        '- préfixe par « ? » les circuits dont tu n\u2019es pas certain du nom exact.\n\n' +
        'Termine par la liste de tes sources (pages exactes consultées) et la date du jour. Rien d\u2019autre.';
    }
    aiGame.addEventListener('input', buildPrompt);
    aiPlatform.addEventListener('input', buildPrompt);
    buildPrompt();
    const copyBtn = h('button', {
      class: 'btn btn-outline btn-block', 'data-testid': 'button-copy-prompt',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(aiPrompt.value);
          toast('Prompt copié — collez-le dans votre IA');
        } catch (e) {
          aiPrompt.select();
          try { document.execCommand('copy'); toast('Prompt copié'); }
          catch (e2) { toast('Copie impossible : sélectionnez le texte manuellement', 'err'); }
        }
      },
    }, 'Copier le prompt');
    const searchBtn = h('button', {
      class: 'btn btn-primary btn-block', 'data-testid': 'button-open-ai',
      onclick: () => {
        const url = 'https://www.perplexity.ai/search?q=' + encodeURIComponent(aiPrompt.value);
        const w = window.open(url, '_blank');
        if (!w) toast('Ouverture bloquée — copiez le prompt et ouvrez votre IA', 'err');
      },
    }, 'Lancer la recherche (Perplexity)');

    // ---- Analyse de la liste ----
    function parseList(text) {
      const groups = [];
      let cur = null;
      for (const raw of String(text).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const m = line.match(/^(?:=+|#+)\s*(.*?)\s*(?:=+|#+)?$/);
        if (m && /^[=#]/.test(line)) {
          const gname = m[1].replace(/[=#]/g, '').trim();
          if (gname) { cur = { name: gname, contents: [] }; groups.push(cur); }
          continue;
        }
        const name = line.replace(/^\d+\s*[.)\-:]\s*/, '').replace(/^\?\s*/, '').trim();
        if (!name) continue;
        if (!cur) { cur = { name: null, contents: [] }; groups.push(cur); }
        cur.contents.push(name);
      }
      return groups;
    }

    // Cible quand la liste n'a pas de sections
    const edSel = h('select', { class: 'select', 'aria-label': 'Édition cible', 'data-testid': 'select-target-edition' });
    const newEdName = h('input', { class: 'input', type: 'text', placeholder: 'Nom de la nouvelle édition…', 'aria-label': 'Nom de la nouvelle édition' });
    const newEdDlc = h('input', { type: 'checkbox' });
    const statusSel = h('select', { class: 'select', 'aria-label': 'Statut' },
      h('option', { value: 'verified' }, 'Vérifié'),
      h('option', { value: 'unverified' }, 'À vérifier')
    );
    const sourceInput = h('input', { class: 'input', type: 'text', placeholder: 'Ex. : IA Perplexity, wiki…', value: '' });
    const previewBox = h('div', { class: 'stack import-preview' });
    const importBtn = h('button', { class: 'btn btn-primary btn-block', 'data-testid': 'button-import' }, 'Importer');

    function refreshEdSel() {
      edSel.innerHTML = '';
      game.editions.forEach((ed) => {
        const o = h('option', { value: ed.id }, ed.name + ' (' + ed.contents.length + ')');
        edSel.append(o);
      });
      edSel.append(h('option', { value: '__new__' }, '➕ Nouvelle édition…'));
      edSel.value = game.editions[0] ? game.editions[0].id : '__new__';
      edSel.dispatchEvent(new Event('change'));
    }
    let targetNew = false;
    edSel.addEventListener('change', () => {
      targetNew = edSel.value === '__new__';
      newEdName.style.display = targetNew ? '' : 'none';
      if (newEdDlc.parentElement) newEdDlc.parentElement.style.display = targetNew ? '' : 'none';
    });

    function refresh() {
      const parsed = parseList(ta.value);
      const hasSections = parsed.some((g) => g.name);
      previewBox.innerHTML = '';
      const total = parsed.reduce((s, g) => s + g.contents.length, 0);
      importBtn.disabled = total === 0;
      importBtn.textContent = total ? 'Importer ' + total + ' circuit' + (total > 1 ? 's' : '') : 'Importer';

      if (!total) {
        previewBox.append(h('p', { class: 'sub', style: 'text-align:center' }, 'Rien à importer pour l\u2019instant.'));
        return;
      }
      previewBox.append(h('span', { class: 'field-label' }, 'Aperçu — ' + total + ' contenu(s)'));
      parsed.forEach((g, groupIndex) => {
        const existing = new Set(game.editions.flatMap((e) => e.contents.map((c) => c.name.toLowerCase())));
        previewBox.append(h('div', { class: 'card', style: 'padding:10px 12px' },
          h('div', { class: 'spread' },
            h('strong', { style: 'font-size:.9rem' }, g.name ? '== ' + g.name + ' ==' : 'Sans section → édition cible'),
            h('span', { class: 'badge' }, g.contents.length + ' circuits')
          ),
          h('div', { class: 'stack', style: 'margin-top:8px;max-height:280px;overflow:auto' },
            g.contents.map((name, index) => h('div', { class: 'content-row' },
              h('span', { class: 'content-name' }, name +
                (existing.has(name.toLowerCase()) ? ' (doublon)' : '')),
              h('button', {
                class: 'btn btn-ghost btn-sm', 'aria-label': 'Retirer ' + name,
                'data-testid': 'remove-preview-' + groupIndex + '-' + index,
                onclick: () => {
                  g.contents.splice(index, 1);
                  ta.value = parsed.filter((group) => group.contents.length).map((group) =>
                    (group.name ? '== ' + group.name + ' ==\n' : '') +
                    group.contents.join('\n')).join('\n\n');
                  refresh();
                },
              }, 'Retirer')
            ))
          )
        ));
      });
      const nDup = parsed.reduce((s, g) => s + g.contents.filter((n) =>
        game.editions.some((e) => e.contents.some((c) => c.name.toLowerCase() === n.toLowerCase()))).length, 0);
      previewBox.append(h('p', { class: 'sub' },
        (hasSections
          ? 'Les sections créeront (ou réutiliseront) une édition chacune — vous pourrez les activer/désactiver séparément dans les tirages. '
          : 'Tous les contenus iront dans l\u2019édition cible. ') +
        (nDup ? nDup + ' doublon(s) seront ignorés.' : '')));
    }

    function setMode(m) {
      mode = m;
      tabBtns.innerHTML = '';
      [['liste', 'Coller une liste'], ['fichier', 'Fichier'], ['ia', 'Recherche IA']].forEach(([k, label]) => {
        tabBtns.append(h('button', {
          class: 'btn btn-sm ' + (k === mode ? 'btn-primary' : 'btn-ghost'),
          'data-testid': 'tab-import-' + k,
          'aria-pressed': String(k === mode),
          onclick: () => setMode(k),
        }, label));
      });
      Object.entries(panes).forEach(([k, el]) => (el.style.display = k === mode ? '' : 'none'));
    }
    setMode('liste');
    refreshEdSel();

    panes.liste.append(
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Liste des circuits'), ta),
      h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Édition cible (sans sections)'),
        edSel,
        newEdName,
        h('label', { class: 'content-row', style: 'cursor:pointer;margin-top:6px' },
          newEdDlc, h('span', { class: 'content-name' }, 'Nouvelle édition = DLC / extension'))
      )
    );
    panes.fichier.append(
      h('label', { class: 'field' },
        h('span', { class: 'field-label' }, 'Fichier .txt, .csv ou .json'),
        fileInput
      ),
      h('p', { class: 'sub' }, 'Txt : un circuit par ligne · CSV : première colonne · JSON : liste de noms, ou {editions: [{name, contents}]} pour importer les découpes d\u2019un coup. Le contenu du fichier est chargé dans l\u2019onglet « Coller une liste ».')
    );
    panes.ia.append(
      h('div', { class: 'row' },
        h('label', { class: 'field', style: 'flex:1' }, h('span', { class: 'field-label' }, 'Jeu'), aiGame),
        h('label', { class: 'field', style: 'flex:1' }, h('span', { class: 'field-label' }, 'Plateforme'), aiPlatform)
      ),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Prompt prêt à l\u2019emploi'), aiPrompt),
      copyBtn,
      searchBtn,
      h('p', { class: 'sub' }, 'La recherche ouvre Perplexity avec ce prompt. Copiez ensuite la réponse (un circuit par ligne) dans l\u2019onglet « Coller une liste » — le statut « À vérifier » est pensé pour ça.')
    );

    importBtn.addEventListener('click', () => {
      const parsed = parseList(ta.value);
      if (!parsed.some((g) => g.contents.length)) return;
      let targetEd = null;
      if (edSel.value === '__new__') {
        targetEd = { id: newId('e'), name: newEdName.value.trim() || 'Nouvelle édition', dlc: newEdDlc.checked, active: true, contents: [] };
        game.editions.push(targetEd);
      } else {
        targetEd = game.editions.find((e) => e.id === edSel.value);
      }
      const status = statusSel.value;
      const source = sourceInput.value.trim() || 'Import en masse';
      // Doublons détectés à l'échelle du jeu entier (cohérent avec l'aperçu).
      const gameExisting = new Set(game.editions.flatMap((e) => e.contents.map((c) => c.name.toLowerCase())));
      let added = 0, dup = 0, newEds = 0;
      const createdTarget = targetNew;
      if (createdTarget) newEds++;
      for (const g of parsed) {
        let ed = targetEd;
        if (g.name) {
          ed = game.editions.find((e) => e.name.toLowerCase() === g.name.toLowerCase());
          if (!ed) {
            ed = { id: newId('e'), name: g.name, dlc: /dlc|pass|extension|mise à jour|update/i.test(g.name), active: true, contents: [] };
            game.editions.push(ed);
            newEds++;
          }
        }
        if (!ed) continue;
        for (const name of g.contents) {
          if (gameExisting.has(name.toLowerCase())) { dup++; continue; }
          ed.contents.push({ id: newId('c'), name, tags: [], status, active: true, source });
          gameExisting.add(name.toLowerCase());
          added++;
        }
      }
      save();
      if (!flushSave()) return;
      close();
      toast(added + ' contenu(s) importé(s)' + (newEds ? ' · ' + newEds + ' édition(s) créée(s)' : '') + (dup ? ' · ' + dup + ' doublon(s) ignoré(s)' : ''));
    });

    const close = () => { location.hash = '#/jeux/' + game.id; };
    const view = h('div', { class: 'stack fade-in import-page' },
      h('a', { class: 'back-link', href: '#/jeux/' + game.id }, '← ' + game.name),
      h('h1', { class: 'page-title' }, 'Importer des circuits'),
      h('p', { class: 'sub' }, game.name + ' · Ajoutez une liste ou un fichier, puis vérifiez les circuits avant de les importer.'),
      h('div', { class: 'import-layout' },
        h('section', { class: 'card card-pad-lg stack', 'aria-label': 'Préparer les circuits' },
          h('h2', { class: 'section-title' }, 'Préparer la liste'), tabBtns,
          panes.liste, panes.fichier, panes.ia,
          h('details', { class: 'draw-options' }, h('summary', {}, 'Statut et source des circuits'),
            h('div', { class: 'row', style: 'flex-wrap:wrap;gap:10px' },
          h('label', { class: 'field', style: 'flex:1;min-width:130px' }, h('span', { class: 'field-label' }, 'Statut des imports'), statusSel),
          h('label', { class: 'field', style: 'flex:2;min-width:180px' }, h('span', { class: 'field-label' }, 'Source'), sourceInput)
            ))),
        h('section', { class: 'card card-pad-lg stack import-review', 'aria-label': 'Vérifier et importer' },
          h('h2', { class: 'section-title' }, 'Vérifier et importer'),
          h('p', { class: 'sub' }, 'Retirez les erreurs dans l’aperçu. Aucun circuit n’est ajouté avant votre clic sur Importer.'),
          previewBox, importBtn)));
    edSel.dispatchEvent(new Event('change'));
    refresh();
    return view;
  }

  function addEditionModal() {
    const name = h('input', { class: 'input', type: 'text', placeholder: 'Ex. : Extension, DLC, liste maison…' });
    const dlc = h('input', { type: 'checkbox' });
    modal({
      title: 'Nouvelle édition',
      body: h('div', { class: 'stack' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Nom'), name),
        h('label', { class: 'content-row', style: 'cursor:pointer' }, dlc, h('span', { class: 'content-name' }, 'Extension / DLC payant'))
      ),
      actions: [
        { label: 'Annuler' },
        {
          label: 'Créer', kind: 'btn-primary',
          onClick: (close) => {
            game.editions.push({
              id: newId('e'), name: name.value.trim() || 'Nouvelle édition',
              dlc: dlc.checked, active: true, contents: [],
            });
            saveGame();
            close();
            toast('Édition créée');
          },
        },
      ],
    });
  }

  function deleteGame() {
    const used = st.sessions.some((s) => s.grandPrix.some((g) => g.gameId === game.id));
    if (used) {
      confirmModal({
        title: 'Jeu utilisé dans l\u2019historique',
        message: 'Ce jeu apparaît dans des sessions passées : il sera archivé (et non supprimé) pour préserver l\u2019historique.',
        confirmLabel: 'Archiver',
        onConfirm: () => { game.archived = true; saveGame(); toast('Jeu archivé'); },
      });
    } else {
      confirmModal({
        title: 'Supprimer ce jeu ?',
        message: 'Toutes ses éditions et contenus seront définitivement supprimés.',
        confirmLabel: 'Supprimer', danger: true,
        onConfirm: () => {
          st.games = st.games.filter((g) => g.id !== game.id);
          save();
          toast('Jeu supprimé');
          location.hash = '#/jeux';
        },
      });
    }
  }

  if (importing) return importPage();
  return h('div', { class: 'stack fade-in' },
    h('a', { class: 'back-link', href: '#/jeux' }, '← Bibliothèque'),
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title' }, game.icon + '  ' + game.name),
        h('p', { class: 'sub' }, [game.platform, game.genre, 'Contenu tiré : ' + game.contentType].filter(Boolean).join(' · '))
      ),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-ghost btn-sm', 'data-testid': 'button-edit-game', onclick: editGameModal }, 'Modifier'),
        h('button', { class: 'btn btn-danger btn-sm', onclick: deleteGame }, 'Supprimer')
      )
    ),
    h('div', { class: 'row' },
      h('button', {
        class: 'btn btn-outline btn-sm',
        onclick: () => {
          download(game.name.replace(/\s+/g, '-').toLowerCase() + '.json', JSON.stringify({ game }, null, 2));
          toast('Jeu exporté');
        },
      }, 'Exporter ce jeu (JSON)'),
      game.archived
        ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { game.archived = false; saveGame(); } }, 'Désarchiver')
        : h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { game.archived = true; saveGame(); toast('Jeu archivé — l\u2019historique est préservé'); } }, 'Archiver')
    ),
    h('div', { class: 'row' },
      h('a', { class: 'btn btn-primary', 'data-testid': 'button-import-contents', href: '#/jeux/' + gameId + '/import' }, 'Importer des circuits'),
      h('button', { class: 'btn btn-outline', 'data-testid': 'button-add-edition', onclick: addEditionModal }, '+ Nouvelle édition'),
      h('span', { class: 'sub' }, 'Une édition = une liste de contenus activable indépendamment dans les tirages.')
    ),
    h('div', { class: 'stack' },
      game.editions.map((ed) => {
        const edToggle = h('button', {
          class: 'switch' + (ed.active ? ' on' : ''),
          role: 'switch', 'aria-checked': String(ed.active),
          'aria-label': 'Édition active pour les tirages',
          onclick: () => {
            ed.active = !ed.active;
            edToggle.classList.toggle('on', ed.active);
            edToggle.setAttribute('aria-checked', String(ed.active));
            save();
          },
        });
        return h('details', { class: 'accord', open: true },
          h('summary', {},
            h('span', { class: 'row' },
              ed.name + (ed.dlc ? ' (DLC)' : ''),
              h('span', { class: 'badge' }, ed.contents.length + ' contenus')
            ),
            edToggle
          ),
          h('div', { class: 'accord-body stack' },
            h('div', { class: 'row' },
              h('button', {
                class: 'btn btn-ghost btn-sm', 'data-testid': 'button-add-contents-' + ed.id,
                onclick: () => addContentsModal(ed),
              }, '+ Ajouter des contenus'),
              h('button', {
                class: 'btn btn-danger btn-sm', 'data-testid': 'button-manage-contents-' + ed.id,
                onclick: () => manageContentsModal(ed),
              }, 'Supprimer des circuits'),
              h('button', {
                class: 'btn btn-outline btn-sm',
                onclick: () => {
                  const name = h('input', { class: 'input', type: 'text', value: ed.name });
                  modal({
                    title: 'Renommer l\u2019édition',
                    body: h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Nom'), name),
                    actions: [
                      { label: 'Annuler' },
                      {
                        label: 'Enregistrer', kind: 'btn-primary',
                        onClick: (close) => { ed.name = name.value.trim() || ed.name; saveGame(); close(); },
                      },
                    ],
                  });
                },
              }, 'Renommer')
            ),
            h('div', { class: 'stack' },
              ed.contents.map((c) => {
                const [label, cls] = STATUS_BADGES[c.status] || [c.status, ''];
                const usedInResults = st.sessions.some((s) =>
                  s.grandPrix.some((g) => g.races.some((r) => r.contentId === c.id))
                );
                return h('div', { class: 'content-row' + (c.status === 'archived' ? ' archived' : '') },
                  h('div', { style: 'flex:1;min-width:0' },
                    h('span', { class: 'content-name', style: 'display:block' }, c.name),
                    c.source ? h('span', { class: 'sub', style: 'font-size:.72rem;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', title: c.source }, c.source) : null
                  ),
                  h('span', { class: 'badge ' + cls }, label),
                  h('button', {
                    class: 'switch' + (c.active ? ' on' : ''),
                    role: 'switch', 'aria-checked': String(c.active),
                    'aria-label': c.name + (c.active ? ' actif' : ' inactif'),
                    onclick: (e) => {
                      e.stopPropagation();
                      c.active = !c.active;
                      e.currentTarget.classList.toggle('on', c.active);
                      e.currentTarget.setAttribute('aria-checked', String(c.active));
                      save();
                    },
                  }),
                  h('button', {
                    class: 'icon-btn', style: 'width:34px;height:34px', 'aria-label': 'Statut de ' + c.name,
                    onclick: () => {
                      const order = ['verified', 'unverified', 'draft', 'archived'];
                      c.status = order[(order.indexOf(c.status) + 1) % order.length];
                      saveGame();
                    },
                  }, h('span', { style: 'font-size:.8rem' }, '↻')),
                  usedInResults
                    ? h('span', { class: 'badge', title: 'Ce contenu apparaît dans des résultats' }, 'Historique')
                    : null
                );
              })
            )
          )
        );
      })
    )
  );
}

// ---------- Classement ----------

export function ClassementView() {
  const st = S();
  const mode = st._rankMode || 'alltime';

  function setMode(m) {
    st._rankMode = m;
    render(ClassementView());
  }

  const tabs = h('div', { class: 'row' },
    h('button', {
      class: 'btn btn-sm ' + (mode === 'alltime' ? 'btn-primary' : 'btn-ghost'),
      'data-testid': 'tab-alltime',
      onclick: () => setMode('alltime'),
    }, 'Tous temps'),
    h('button', {
      class: 'btn btn-sm ' + (mode === 'session' ? 'btn-primary' : 'btn-ghost'),
      'data-testid': 'tab-sessions',
      onclick: () => setMode('session'),
    }, 'Par session')
  );

  let body;
  if (mode === 'alltime') {
    const stats = allTimeStats(st.sessions, st.players);
    const playerById = Object.fromEntries(st.players.map((p) => [p.id, p]));
    body = stats.length
      ? h('div', { class: 'stack' },
          stats.map((row, i) => {
            const p = playerById[row.pid];
            if (!p) return null;
            return h('div', { class: 'rank-row' + (i === 0 ? ' first' : '') },
              h('span', { class: 'rank-pos' }, String(i + 1)),
              avatarEl(p),
              h('div', { style: 'flex:1;min-width:0' },
                h('div', { style: 'font-weight:600' }, p.name),
                h('div', { class: 'rank-sub' }, pl(row.wins, 'victoire') + ' · ' + pl(row.podiums, 'podium') + ' · ' + pl(row.gps, 'GP'))
              ),
              h('span', { class: 'rank-pts' }, row.pts + ' pts')
            );
          })
        )
      : h('p', { class: 'sub' }, 'Validez un premier Grand Prix pour alimenter le classement.');
  } else {
    body = st.sessions.length
      ? h('div', { class: 'stack' },
          st.sessions.slice().reverse().map((s) => {
            const ranking = sessionRanking(s);
            const playerById = Object.fromEntries(st.players.map((p) => [p.id, p]));
            return h('details', { class: 'accord' },
              h('summary', {},
                h('span', { class: 'row' },
                  h('strong', {}, s.name),
                  s.status === 'open' ? h('span', { class: 'badge badge-ok' }, 'En cours') : h('span', { class: 'badge' }, 'Terminée')
                )
              ),
              h('div', { class: 'accord-body stack' },
                ranking.length
                  ? ranking.map((row, i) => h('div', { class: 'rank-row' + (i === 0 ? ' first' : '') },
                      h('span', { class: 'rank-pos' }, String(i + 1)),
                      playerById[row.pid] ? avatarEl(playerById[row.pid]) : null,
                      h('span', { style: 'font-weight:600' }, playerById[row.pid] ? playerById[row.pid].name : '?'),
                      h('span', { class: 'rank-pts' }, row.pts + ' pts')
                    ))
                  : h('p', { class: 'sub' }, 'Aucun GP validé.')
              )
            );
          })
        )
      : h('p', { class: 'sub' }, 'Aucune session pour l\u2019instant.');
  }

  const exportCsvBtn = h('button', {
    class: 'btn btn-outline btn-sm',
    onclick: () => {
      const rows = [['Joueur', 'Points', 'Victoires', 'Podiums', 'GP']];
      for (const r of allTimeStats(st.sessions, st.players)) {
        const p = st.players.find((x) => x.id === r.pid);
        rows.push([p ? p.name : '?', r.pts, r.wins, r.podiums, r.gps]);
      }
      const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\n');
      download('classement-mario-kart-party.csv', '\ufeff' + csv, 'text/csv');
      toast('Classement exporté (CSV)');
    },
  }, 'Exporter en CSV');

  return h('div', { class: 'stack fade-in' },
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title' }, 'Classements'),
        h('p', { class: 'sub' }, 'Seuls les Grands Prix validés comptent.')
      ),
      exportCsvBtn
    ),
    tabs,
    body
  );
}

// ---------- Réglages ----------

export function ReglagesView() {
  const st = S();

  const nameInput = h('input', {
    class: 'input', type: 'text', value: st.settings.appName,
    'data-testid': 'input-app-name', 'aria-label': 'Nom de l\u2019application',
  });
  nameInput.addEventListener('change', () => {
    st.settings.appName = nameInput.value.trim() || 'Mario Kart Party';
    save();
    document.getElementById('brand-name').textContent = st.settings.appName;
    toast('Nom enregistré');
  });

  // Barème
  const baremeBox = h('div', { class: 'pos-grid' });
  function refreshBareme() {
    baremeBox.innerHTML = '';
    st.settings.bareme.forEach((val, i) => {
      baremeBox.append(h('label', { class: 'field', style: 'text-align:center' },
        h('span', { class: 'field-label' }, (i + 1) + (i === 0 ? 'er' : 'e')),
        h('input', {
          class: 'input', type: 'number', min: 0, value: val,
          style: 'width:64px;min-height:42px;text-align:center;padding:6px',
          'aria-label': 'Points pour la ' + (i + 1) + ' place',
          onchange: (e) => {
            st.settings.bareme[i] = Math.max(0, parseInt(e.target.value, 10) || 0);
            save();
            toast('Barème mis à jour — les GP déjà validés gardent leur barème');
          },
        })
      ));
    });
  }
  refreshBareme();

  const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'sr-only' });
  fileInput.addEventListener('change', async () => {
    if (!fileInput.files[0]) return;
    try {
      const text = await readFile(fileInput.files[0]);
      confirmModal({
        title: 'Importer cette sauvegarde ?',
        message: 'Les données actuelles seront remplacées par celles du fichier.',
        confirmLabel: 'Importer',
        onConfirm: () => {
          try {
            importJSON(text);
            toast('Sauvegarde importée');
            render(HomeView());
            location.hash = '#/';
          } catch (e) {
            toast(e.message, 'err');
          }
        },
      });
    } catch (e) {
      toast('Lecture du fichier impossible', 'err');
    }
    fileInput.value = '';
  });

  return h('div', { class: 'stack fade-in' },
    h('h1', { class: 'page-title' }, 'Réglages'),
    h('div', { class: 'card card-pad-lg stack' },
      h('h2', { class: 'section-title' }, 'Application'),
      h('p', { class: 'sub', 'data-testid': 'app-version' }, 'Version ' + APP_VERSION),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Nom affiché'), nameInput),
      h('p', { class: 'sub' }, 'Thème : utilisez l\u2019icône lune/soleil dans l\u2019en-tête. L\u2019app suit le réglage de votre appareil par défaut.')
    ),
    h('div', { class: 'card card-pad-lg stack' },
      h('h2', { class: 'section-title' }, 'Barème par position'),
      h('p', { class: 'sub' }, 'Barème de travail de l\u2019application, modifiable. Il n\u2019est pas présenté comme un barème officiel. Les Grands Prix déjà validés conservent le barème enregistré à leur création.'),
      baremeBox
    ),
    h('div', { class: 'card card-pad-lg stack' },
      h('h2', { class: 'section-title' }, 'Données'),
      h('button', {
        class: 'btn btn-ghost', disabled: !previousBackup(), 'data-testid': 'button-export-previous',
        onclick: () => {
          const backup = previousBackup();
          if (backup) download('mario-kart-party-sauvegarde-precedente.json', backup, 'application/json');
        },
      }, 'Exporter la sauvegarde précédente'),
      h('p', { class: 'sub' },
        isPersistent()
          ? 'Vos données sont enregistrées uniquement sur cet appareil (stockage local du navigateur). Exportez une sauvegarde régulièrement : effacer les données du navigateur supprimerait la sauvegarde.'
          : 'Sauvegarde locale indisponible dans cet aperçu intégré. Installez l\u2019application sur votre appareil pour conserver vos données.'),
      h('div', { class: 'row' },
        h('button', {
          class: 'btn btn-ghost', 'data-testid': 'button-export',
          onclick: () => {
            download('mario-kart-party-sauvegarde.json', exportJSON());
            toast('Sauvegarde exportée');
          },
        }, 'Exporter (JSON)'),
        h('button', {
          class: 'btn btn-ghost', 'data-testid': 'button-import',
          onclick: () => fileInput.click(),
        }, 'Importer une sauvegarde'),
        fileInput
      ),
      h('hr', { class: 'divider' }),
      h('button', {
        class: 'btn btn-danger', 'data-testid': 'button-reset',
        onclick: () => confirmModal({
          title: 'Tout effacer ?',
          message: 'Sessions, résultats, jeux personnalisés et joueurs seront supprimés. Les jeux préchargés seront rétablis. Cette action est irréversible.',
          confirmLabel: 'Tout effacer', danger: true,
          onConfirm: () => {
            resetAll();
            toast('Données réinitialisées');
            render(HomeView());
            location.hash = '#/';
          },
        }),
      }, 'Réinitialiser toutes les données')
    ),
    h('p', { class: 'sub', style: 'font-size:.8rem' },
      'Application non officielle, sans affiliation avec Nintendo. Mario Kart est une marque de Nintendo. Les catalogues préchargés sont fournis à titre indicatif avec leur source, et restent vérifiables et modifiables.')
  );
}
