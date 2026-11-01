// ============================================================
// Vues secondaires : tirage rapide, bibliothèque de jeux,
// classements, réglages.
// ============================================================

import {
  getState, save, findGame, newId, activeGames, gameContents,
  exportJSON, importJSON, resetAll, isPersistent,
} from './store.js';
import { h, render, toast, modal, confirmModal, fmtDateTime, download, readFile, avatarEl } from './ui.js';
import { drawItems, eligibleItems, sessionRanking, allTimeStats, RACE_STATUSES } from './engine.js';
import { NotFound, HomeView } from './views.js';

const S = () => getState();

// ---------- Tirage rapide ----------

export function TirageView() {
  const st = S();
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

  let selectedGame = games[0];
  let selectedEditions = new Set(selectedGame.editions.filter((e) => e.active).map((e) => e.id));
  let count = 4;
  let unique = true;
  let excludeRecent = false;
  let lockedIds = [];
  let currentItems = [];

  const gameSel = h('select', { class: 'select', 'aria-label': 'Jeu', 'data-testid': 'select-draw-game' },
    games.map((g) => h('option', { value: g.id, selected: g === selectedGame }, g.icon + '  ' + g.name))
  );
  gameSel.addEventListener('change', () => {
    selectedGame = findGame(gameSel.value);
    selectedEditions = new Set(selectedGame.editions.filter((e) => e.active).map((e) => e.id));
    lockedIds = [];
    currentItems = [];
    refreshEditions();
    refreshInfo();
    drawResults();
  });

  const editionsBox = h('div', { class: 'stack' });
  function refreshEditions() {
    editionsBox.innerHTML = '';
    selectedGame.editions.forEach((ed) => {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = selectedEditions.has(ed.id);
      cb.addEventListener('change', () => {
        if (cb.checked) selectedEditions.add(ed.id);
        else selectedEditions.delete(ed.id);
        refreshInfo();
      });
      editionsBox.append(h('label', { class: 'content-row', style: 'cursor:pointer' },
        cb,
        h('span', { class: 'content-name' }, ed.name + (ed.dlc ? ' (DLC)' : '')),
        h('span', { class: 'badge' }, ed.contents.length + ' contenus')
      ));
    });
  }

  const countInput = h('input', {
    class: 'input', type: 'number', min: 1, max: 24, value: 4,
    style: 'max-width:100px', 'aria-label': 'Nombre de contenus', 'data-testid': 'input-draw-count',
  });
  countInput.addEventListener('input', () => {
    count = Math.max(1, Math.min(24, parseInt(countInput.value, 10) || 4));
    refreshInfo();
  });

  const infoBox = h('p', { class: 'sub' });
  const drawBtn = h('button', { class: 'btn btn-primary btn-block', 'data-testid': 'button-draw' }, 'Tirer au sort');
  const rerollBtn = h('button', { class: 'btn btn-ghost btn-block', 'data-testid': 'button-reroll' }, 'Relancer (hors verrouillés)');
  const resultsBox = h('div', { class: 'stack' });

  function usedContentIds() {
    // Contenus déjà tirés lors des 5 derniers tirages enregistrés.
    const ids = new Set();
    for (const d of st.sessions.flatMap((s) => s.draws).slice(-5)) {
      for (const cid of d.contentIds || []) ids.add(cid);
    }
    return ids;
  }

  function refreshInfo() {
    const contents = gameContents(selectedGame, [...selectedEditions]);
    const eligible = eligibleItems(contents, { excludeIds: excludeRecent ? [...usedContentIds()] : [] });
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
    const contents = gameContents(selectedGame, [...selectedEditions]);
    const eligible = eligibleItems(contents, { excludeIds: excludeRecent ? [...usedContentIds()] : [] });
    const res = drawItems(eligible, { count, unique, lockedIds: keepLocked ? lockedIds : [] });
    if (res.error) { refreshInfo(); return; }
    currentItems = res.items;
    lockedIds = [];
    drawResults();
    // Historique des tirages (attaché à la session ouverte, sinon global via session fictive)
    if (keepLocked === undefined) {
      const sess = st.sessions.filter((s) => s.status === 'open').slice(-1)[0];
      const entry = {
        date: Date.now(), gameId: selectedGame.id, gameName: selectedGame.name,
        contentIds: res.items.map((c) => c.id), names: res.items.map((c) => c.name),
      };
      if (sess) sess.draws.push(entry);
      else st.draws = [...(st.draws || []), entry];
      save();
    }
  }

  function drawResults() {
    resultsBox.innerHTML = '';
    if (!currentItems.length) {
      resultsBox.append(h('p', { class: 'sub', style: 'text-align:center;padding:8px 0' },
        'Réglez les filtres puis lancez le tirage.'));
      return;
    }
    currentItems.forEach((c) => {
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
      }, h('svg', { viewBox: '0 0 24 24' },
        locked
          ? h('path', { d: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9H5z' })
          : h('path', { d: 'M7 11V8a5 5 0 0 1 9.9-1M5 11h14v9H5z' })
      ));
      resultsBox.append(h('div', { class: 'card draw-card' },
        lockBtn,
        h('div', { class: 'badge' }, selectedGame.icon + ' ' + (c.editionName || '')),
        h('div', { class: 'draw-name', style: 'margin:8px 0 4px' }, c.name),
        c.status === 'unverified'
          ? h('span', { class: 'badge badge-warn' }, 'Nom à vérifier')
          : null
      ));
    });
  }

  drawBtn.addEventListener('click', () => doDraw(false));
  rerollBtn.addEventListener('click', () => doDraw(true));

  const uniqueToggle = mkToggle2(true, (v) => { unique = v; refreshInfo(); });
  const recentToggle = mkToggle2(false, (v) => { excludeRecent = v; refreshInfo(); });

  refreshEditions();
  refreshInfo();
  drawResults();

  return h('div', { class: 'stack fade-in' },
    h('h1', { class: 'page-title' }, 'Tirage rapide'),
    h('p', { class: 'sub' }, 'Tirez des circuits sans doublon, verrouillez vos préférés et relancez le reste.'),
    h('div', { class: 'card card-pad-lg stack' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Jeu'), gameSel),
      h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Éditions / extensions'),
        editionsBox
      ),
      h('label', { class: 'field' },
        h('span', { class: 'field-label' }, 'Nombre de contenus'),
        countInput
      ),
      h('div', { class: 'spread' }, h('span', {}, 'Interdire les doublons'), uniqueToggle),
      h('div', { class: 'spread' }, h('span', {}, 'Exclure les contenus des 5 derniers tirages'), recentToggle),
      infoBox,
      drawBtn
    ),
    currentItems.length ? rerollBtn : null,
    resultsBox
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

export function GameView(gameId) {
  const st = S();
  const game = findGame(gameId);
  if (!game) return NotFound();

  function saveGame() { save(); render(GameView(gameId)); }

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
      h('button', { class: 'btn btn-primary', 'data-testid': 'button-add-edition', onclick: addEditionModal }, '+ Nouvelle édition'),
      h('span', { class: 'sub' }, 'Une édition = une liste de contenus activable indépendamment.')
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
                  h('span', { class: 'content-name' }, c.name),
                  c.source ? h('span', { class: 'sub', style: 'font-size:.72rem;max-width:30%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', title: c.source }, c.source) : null,
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
                h('div', { class: 'rank-sub' }, row.wins + ' victoires · ' + row.podiums + ' podiums · ' + row.gps + ' GP')
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
