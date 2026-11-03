// ============================================================
// Vues secondaires : tirage express, jeux et circuits,
// classements, réglages.
// ============================================================

import {
  getState, save, flushSave, findGame, newId,
  exportJSON, importJSON, resetAll, isPersistent, previousBackup,
} from './store.js';
import { h, render, toast, modal, confirmModal, fmtDate, download, readFile, avatarEl } from './ui.js';
import { sessionRanking, allTimeStats } from './engine.js';
import { NotFound, HomeView } from './views.js';
import { DrawPrefsEditor, drawCourses, getDrawPrefs } from './draw.js';
import { raceGame, gameStyle, gameBadge, timelineStep, racersFor } from './race-visuals.js';
import { APP_VERSION } from './updates.js';

const S = () => getState();
const pl = (n, word) => n + ' ' + word + (n > 1 ? 's' : '');
const isUsed = (st, contentId) => st.sessions.some((s) =>
  s.grandPrix.some((g) => g.races.some((r) => r.contentId === contentId)));

// ---------- Tirage express (sans scores) ----------

export function TirageView() {
  const st = S();
  let items = [];
  let lockedIds = [];
  const resultsBox = h('div', { class: 'draw-results' });
  const resultsTitle = h('h2', { class: 'section-title', style: 'margin:0', tabindex: '-1' }, 'Votre grille');
  const rerollBtn = h('button', { class: 'btn btn-outline btn-sm', 'data-testid': 'button-reroll',
    onclick: () => draw(true) }, 'Relancer les courses libres');
  const drawBtn = h('button', { class: 'btn btn-primary btn-block', 'data-testid': 'button-draw',
    onclick: () => draw(false) }, 'Tirer au sort');

  function draw(keepLocked) {
    const locked = keepLocked ? items.filter((c) => lockedIds.includes(c.id)) : [];
    const res = drawCourses(st, getDrawPrefs(st), { lockedItems: locked, count: keepLocked ? items.length : undefined });
    if (res.error) { toast('Pas assez de circuits disponibles avec ces jeux', 'err'); return; }
    if (keepLocked) {
      const fresh = res.items.filter((c) => !lockedIds.includes(c.id));
      items = items.map((c) => lockedIds.includes(c.id) ? c : fresh.shift());
    } else {
      items = res.items;
      lockedIds = [];
    }
    refresh();
    resultsTitle.focus({ preventScroll: true });
    resultsTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function changeOne(index) {
    const res = drawCourses(st, getDrawPrefs(st), { count: 1, excludeIds: items.map((c) => c.id) });
    if (res.error) { toast('Aucun autre circuit disponible', 'err'); return; }
    items[index] = res.items[0];
    refresh();
  }

  function refresh() {
    rerollBtn.hidden = !items.length;
    rerollBtn.disabled = items.length > 0 && items.every((c) => lockedIds.includes(c.id));
    if (!items.length) {
      resultsBox.replaceChildren(h('p', { class: 'sub' }, 'Choisissez vos jeux, puis tirez au sort.'));
      return;
    }
    const timeline = h('ol', { class: 'race-timeline', 'aria-label': 'Ordre des courses tirées' });
    items.forEach((c, index) => {
      const game = raceGame(c);
      const locked = lockedIds.includes(c.id);
      const card = h('div', { class: 'draw-course draw-card timeline-card' + (locked ? ' is-locked' : ''), style: gameStyle(game) },
        h('div', { class: 'draw-course-copy' },
          gameBadge(game),
          h('div', { class: 'draw-name' }, c.name),
          h('div', { class: 'sub' }, c.editionName || 'Jeu de base')),
        h('div', { class: 'draw-course-tools' },
          h('button', {
            class: 'lock-btn' + (locked ? ' on' : ''), 'aria-pressed': String(locked),
            'aria-label': (locked ? 'Libérer ' : 'Garder ') + c.name,
            onclick: () => {
              lockedIds = locked ? lockedIds.filter((x) => x !== c.id) : [...lockedIds, c.id];
              refresh();
            },
          }, locked ? 'Gardée' : 'Garder'),
          h('button', {
            class: 'btn btn-ghost btn-sm', disabled: locked, 'data-testid': 'reroll-course-' + index,
            'aria-label': 'Remplacer ' + c.name, onclick: () => changeOne(index),
          }, 'Changer')));
      timeline.append(timelineStep({
        index, game, previousGame: index ? raceGame(items[index - 1]) : null, card,
        label: index === 0 ? 'DÉPART' : index === items.length - 1 ? 'DERNIÈRE COURSE' : '',
      }));
    });
    resultsBox.replaceChildren(timeline, h('div', { class: 'timeline-finish' }, 'ARRIVÉE · ' + pl(items.length, 'course')));
  }
  refresh();

  return h('div', { class: 'stack fade-in draw-page' },
    h('a', { class: 'back-link', href: '#/' }, '← Soirée'),
    h('h1', { class: 'page-title' }, 'Tirage express'),
    h('p', { class: 'sub' }, 'Juste les circuits, sans scores. Pour compter les points, lancez une soirée.'),
    h('div', { class: 'draw-layout' },
      h('section', { class: 'card card-pad-lg stack draw-config', 'aria-label': 'Jeux et courses' },
        DrawPrefsEditor(st, { onChange: () => { items = []; lockedIds = []; refresh(); } }),
        drawBtn),
      h('section', { class: 'card card-pad-lg stack draw-output', 'aria-label': 'Résultat du tirage' },
        h('div', { class: 'spread' }, resultsTitle, rerollBtn),
        resultsBox)));
}

// ---------- Jeux (dans les réglages) ----------

function gameModal(game = null) {
  const st = S();
  const name = h('input', { class: 'input', type: 'text', value: game?.name || '', placeholder: 'Ex. : Mario Kart 64', 'data-testid': 'input-game-name' });
  const icon = h('input', { class: 'input', type: 'text', value: game?.icon || '', placeholder: '🏎️', maxlength: 4, style: 'max-width:90px' });
  const currentRacers = game ? racersFor(game) : 12;
  const racers = h('select', { class: 'input', 'data-testid': 'select-game-racers' },
    [8, 12, 24].map((n) => h('option', { value: n, selected: n === currentRacers }, n + ' pilotes')));
  modal({
    title: game ? 'Modifier le jeu' : 'Nouveau jeu',
    body: h('div', { class: 'stack' },
      h('div', { class: 'row' },
        h('label', { class: 'field', style: 'flex:1' }, h('span', { class: 'field-label' }, 'Nom du jeu'), name),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Icône'), icon)),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Pilotes par course'), racers)),
    actions: [
      { label: 'Annuler' },
      {
        label: game ? 'Enregistrer' : 'Créer', kind: 'btn-primary', testid: 'button-create-game',
        onClick: (close) => {
          const value = name.value.trim();
          if (value.length < 2) { toast('Le nom du jeu est requis', 'err'); return; }
          if (game) {
            game.name = value;
            game.icon = icon.value.trim() || game.icon;
            game.racers = Number(racers.value);
            save(); close(); render(GameView(game.id));
            return;
          }
          const created = {
            id: newId('g'), name: value, icon: icon.value.trim() || '🏎️', racers: Number(racers.value),
            archived: false, createdAt: Date.now(),
            editions: [{ id: newId('e'), name: 'Jeu de base', dlc: false, active: true, contents: [] }],
          };
          st.games.push(created);
          save(); close();
          location.hash = '#/jeux/' + created.id + '/import';
        },
      },
    ],
  });
}

function GamesSection() {
  const st = S();
  const games = st.games.filter((g) => !g.archived);
  return h('div', { class: 'card card-pad-lg stack', 'data-testid': 'section-games' },
    h('div', { class: 'spread' },
      h('h2', { class: 'section-title', style: 'margin:0' }, 'Jeux et circuits'),
      h('button', { class: 'btn btn-outline btn-sm', 'data-testid': 'button-add-game', onclick: () => gameModal() }, '+ Jeu')),
    h('div', { class: 'stack' }, games.map((g) => {
      const total = g.editions.reduce((n, e) => n + e.contents.filter((c) => !c.archived).length, 0);
      return h('a', {
        class: 'content-row card-click', href: '#/jeux/' + g.id,
        style: 'text-decoration:none', 'data-testid': 'card-game-' + g.id,
      },
        h('span', { style: 'font-size:1.3rem' }, g.icon),
        h('span', { class: 'content-name', style: 'flex:1' }, g.name),
        h('span', { class: 'badge' }, total + ' circuits'),
        h('span', { 'aria-hidden': 'true' }, '›'));
    })));
}

export function GameView(gameId, { importing = false } = {}) {
  const st = S();
  const game = findGame(gameId);
  if (!game) return NotFound();
  if (importing) return ImportView(game);

  const refresh = () => render(GameView(gameId));
  const visible = (ed) => ed.contents.filter((c) => !c.archived && c.status !== 'archived');

  // Les circuits déjà joués sont archivés (invisibles) pour préserver les résultats.
  function removeContents(edition, items) {
    const used = new Set(items.filter((c) => isUsed(st, c.id)).map((c) => c.id));
    const ids = new Set(items.map((c) => c.id));
    edition.contents = edition.contents.filter((c) => {
      if (!ids.has(c.id)) return true;
      if (used.has(c.id)) { c.archived = true; c.active = false; return true; }
      return false;
    });
    save();
    refresh();
    toast(pl(items.length, 'circuit') + ' supprimé' + (items.length > 1 ? 's' : ''));
  }

  function manageModal(edition) {
    const selected = new Set();
    const search = h('input', {
      class: 'input', type: 'search', placeholder: 'Rechercher un circuit…',
      'aria-label': 'Rechercher un circuit', 'data-testid': 'input-manage-search',
    });
    const list = h('div', { class: 'stack' });
    const removeBtn = h('button', { class: 'btn btn-danger btn-block', disabled: true, 'data-testid': 'button-remove-selected' });
    const matches = () => visible(edition).filter((c) =>
      c.name.toLocaleLowerCase('fr').includes(search.value.trim().toLocaleLowerCase('fr')));
    function refreshList() {
      list.replaceChildren(...matches().map((c) => {
        const cb = h('input', { type: 'checkbox', checked: selected.has(c.id), 'data-testid': 'select-content-' + c.id });
        cb.addEventListener('change', () => { cb.checked ? selected.add(c.id) : selected.delete(c.id); refreshCount(); });
        return h('label', { class: 'content-row', style: 'cursor:pointer' }, cb, h('span', { class: 'content-name' }, c.name));
      }));
      refreshCount();
    }
    function refreshCount() {
      removeBtn.disabled = !selected.size;
      removeBtn.textContent = selected.size ? 'Supprimer ' + pl(selected.size, 'circuit') : 'Supprimer la sélection';
    }
    removeBtn.addEventListener('click', () => {
      const items = edition.contents.filter((c) => selected.has(c.id));
      close();
      confirmModal({
        title: 'Supprimer ' + pl(items.length, 'circuit') + ' ?',
        message: items.slice(0, 8).map((c) => c.name).join(', ') + (items.length > 8 ? ', …' : '') +
          '. Les résultats passés ne sont pas modifiés.',
        confirmLabel: 'Supprimer', danger: true,
        onConfirm: () => removeContents(edition, items),
      });
    });
    search.addEventListener('input', refreshList);
    const close = modal({
      title: 'Supprimer des circuits — ' + edition.name,
      body: h('div', { class: 'stack' },
        search,
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-outline btn-sm', onclick: () => { matches().forEach((c) => selected.add(c.id)); refreshList(); } }, 'Tout sélectionner'),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { selected.clear(); refreshList(); } }, 'Tout désélectionner')),
        list, removeBtn),
      actions: [{ label: 'Annuler' }],
    });
    refreshList();
  }

  function editionModal(edition = null) {
    const name = h('input', { class: 'input', type: 'text', value: edition?.name || '', placeholder: 'Ex. : Pass circuits' });
    const dlc = h('input', { type: 'checkbox', checked: edition ? !!edition.dlc : true });
    modal({
      title: edition ? 'Modifier l\u2019édition' : 'Nouvelle édition',
      body: h('div', { class: 'stack' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Nom'), name),
        h('label', { class: 'content-row', style: 'cursor:pointer' }, dlc, h('span', { class: 'content-name' }, 'DLC / extension'))),
      actions: [
        { label: 'Annuler' },
        {
          label: 'Enregistrer', kind: 'btn-primary',
          onClick: (close) => {
            if (edition) { edition.name = name.value.trim() || edition.name; edition.dlc = dlc.checked; }
            else game.editions.push({ id: newId('e'), name: name.value.trim() || 'Nouvelle édition', dlc: dlc.checked, active: true, contents: [] });
            save(); close(); refresh();
          },
        },
      ],
    });
  }

  function deleteGame() {
    const used = st.sessions.some((s) => s.grandPrix.some((g) =>
      g.gameId === game.id || g.races.some((r) => r.gameId === game.id)));
    confirmModal({
      title: 'Supprimer ce jeu ?',
      message: used ? 'Les résultats déjà saisis restent dans l\u2019historique.' : 'Ses éditions et circuits seront supprimés.',
      confirmLabel: 'Supprimer', danger: true,
      onConfirm: () => {
        if (used) game.archived = true;
        else st.games = st.games.filter((g) => g.id !== game.id);
        save();
        toast('Jeu supprimé');
        location.hash = '#/reglages';
      },
    });
  }

  return h('div', { class: 'stack fade-in' },
    h('a', { class: 'back-link', href: '#/reglages' }, '← Réglages'),
    h('div', { class: 'page-head' },
      h('h1', { class: 'page-title' }, game.icon + '  ' + game.name),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-ghost btn-sm', 'data-testid': 'button-edit-game', onclick: () => gameModal(game) }, 'Modifier'),
        h('button', { class: 'btn btn-danger btn-sm', onclick: deleteGame }, 'Supprimer'))),
    h('div', { class: 'row' },
      h('a', { class: 'btn btn-primary', 'data-testid': 'button-import-contents', href: '#/jeux/' + gameId + '/import' }, 'Ajouter des circuits'),
      h('button', { class: 'btn btn-outline', 'data-testid': 'button-add-edition', onclick: () => editionModal() }, '+ Édition')),
    h('p', { class: 'sub' }, 'Un interrupteur éteint exclut le circuit des tirages sans le supprimer.'),
    h('div', { class: 'stack' }, game.editions.map((ed) => {
      const contents = visible(ed);
      return h('details', { class: 'accord', open: game.editions.length < 3 },
        h('summary', {},
          h('span', { class: 'row' }, ed.name + (ed.dlc ? ' (DLC)' : ''), h('span', { class: 'badge' }, contents.length))),
        h('div', { class: 'accord-body stack' },
          h('div', { class: 'row' },
            h('button', { class: 'btn btn-ghost btn-sm', onclick: () => editionModal(ed) }, 'Modifier'),
            contents.length ? h('button', {
              class: 'btn btn-ghost btn-sm', 'data-testid': 'button-manage-contents-' + ed.id,
              onclick: () => manageModal(ed),
            }, 'Supprimer des circuits') : null),
          contents.length ? h('div', { class: 'stack' }, contents.map((c) => h('div', { class: 'content-row' },
            h('span', { class: 'content-name', style: 'flex:1' }, c.name),
            h('button', {
              class: 'switch' + (c.active !== false ? ' on' : ''), role: 'switch',
              'aria-checked': String(c.active !== false),
              'aria-label': c.name + ' dans les tirages',
              onclick: (e) => {
                c.active = c.active === false;
                e.currentTarget.classList.toggle('on', c.active);
                e.currentTarget.setAttribute('aria-checked', String(c.active));
                save();
              },
            }))))
            : h('p', { class: 'sub' }, 'Aucun circuit dans cette édition.')));
    })));
}

// ---------- Ajout de circuits ----------

// Une ligne « == Nom == » (ou « # Nom ») ouvre une édition ; un circuit par ligne.
export function parseList(text) {
  const groups = [];
  let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[=#]/.test(line)) {
      const gname = line.replace(/[=#]/g, '').trim();
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

// Fichier txt / csv / json -> texte au format de la liste.
function fileToList(fileName, text) {
  if (/\.json$/i.test(fileName)) {
    const data = JSON.parse(text);
    const lines = [];
    const emit = (arr) => (arr || []).forEach((x) => {
      const name = typeof x === 'string' ? x : (x.name || x.nom || x.circuit || x.title);
      if (name) lines.push(String(name));
    });
    const editions = Array.isArray(data?.editions) ? data.editions : null;
    if (editions) editions.forEach((ed) => { if (ed.name) lines.push('== ' + ed.name + ' =='); emit(ed.contents); });
    else if (Array.isArray(data)) emit(data);
    else emit(data?.contents);
    return lines.join('\n');
  }
  if (/\.csv$/i.test(fileName)) {
    return text.split(/\r?\n/).map((l) => (l.split(/[;,]/)[0] || '').replace(/^["']|["']$/g, '').trim())
      .filter(Boolean).join('\n');
  }
  return text;
}

function ImportView(game) {
  const ta = h('textarea', {
    class: 'textarea', rows: 10, 'data-testid': 'textarea-import', 'aria-label': 'Liste des circuits',
    placeholder: 'Un circuit par ligne.\n\nPour séparer jeu de base et DLC :\n== Jeu de base ==\n…\n== Pass circuits ==\n…',
  });
  const edSel = h('select', { class: 'select', 'aria-label': 'Édition', 'data-testid': 'select-target-edition' },
    game.editions.map((ed) => h('option', { value: ed.id }, ed.name)));
  const targetField = h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Ajouter dans'), edSel);
  const previewBox = h('div', { class: 'stack import-preview' });
  const importBtn = h('button', { class: 'btn btn-primary btn-block', 'data-testid': 'button-import' }, 'Importer');
  const existing = () => new Set(game.editions.flatMap((e) => e.contents.filter((c) => !c.archived).map((c) => c.name.toLowerCase())));

  function refresh() {
    const parsed = parseList(ta.value);
    const known = existing();
    const total = parsed.reduce((n, g) => n + g.contents.length, 0);
    targetField.hidden = parsed.some((g) => g.name);
    importBtn.disabled = !total;
    importBtn.textContent = total ? 'Importer ' + pl(total, 'circuit') : 'Importer';
    if (!total) {
      previewBox.replaceChildren(h('p', { class: 'sub', style: 'text-align:center' }, 'L\u2019aperçu apparaîtra ici.'));
      return;
    }
    previewBox.replaceChildren(...parsed.map((g, gi) => h('div', { class: 'card', style: 'padding:10px 12px' },
      h('div', { class: 'spread' },
        h('strong', { style: 'font-size:.9rem' }, g.name || edSel.selectedOptions[0]?.textContent || 'Circuits'),
        h('span', { class: 'badge' }, g.contents.length)),
      h('div', { class: 'stack', style: 'margin-top:8px;max-height:280px;overflow:auto' },
        g.contents.map((name, i) => h('div', { class: 'content-row' },
          h('span', { class: 'content-name' }, name + (known.has(name.toLowerCase()) ? ' (déjà présent)' : '')),
          h('button', {
            class: 'btn btn-ghost btn-sm', 'aria-label': 'Retirer ' + name,
            'data-testid': 'remove-preview-' + gi + '-' + i,
            onclick: () => {
              g.contents.splice(i, 1);
              ta.value = parsed.filter((x) => x.contents.length).map((x) =>
                (x.name ? '== ' + x.name + ' ==\n' : '') + x.contents.join('\n')).join('\n\n');
              refresh();
            },
          }, 'Retirer')))))));
  }
  ta.addEventListener('input', refresh);
  edSel.addEventListener('change', refresh);

  const fileInput = h('input', { type: 'file', class: 'input', 'data-testid': 'input-import-file',
    accept: '.txt,.csv,.json,text/plain,text/csv,application/json' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      ta.value = fileToList(file.name, await readFile(file));
      refresh();
      toast('Fichier chargé : ' + file.name);
    } catch (e) {
      toast('Fichier illisible (txt, csv ou json attendu)', 'err');
    }
    fileInput.value = '';
  });

  const prompt = 'Liste tous les circuits de « ' + game.name + ' » (jeu de base, DLC et mises à jour) avec leurs noms français officiels. ' +
    'Format : une ligne « == Nom de l\u2019édition == » avant chaque groupe, puis un circuit par ligne, sans numérotation. Rien d\u2019autre.';

  importBtn.addEventListener('click', () => {
    const parsed = parseList(ta.value);
    const known = existing();
    let added = 0;
    for (const g of parsed) {
      let ed = game.editions.find((e) => e.id === edSel.value);
      if (g.name) {
        ed = game.editions.find((e) => e.name.toLowerCase() === g.name.toLowerCase());
        if (!ed) {
          ed = { id: newId('e'), name: g.name, dlc: /dlc|pass|extension|bonus|booster/i.test(g.name), active: true, contents: [] };
          game.editions.push(ed);
        }
      }
      if (!ed) continue;
      for (const name of g.contents) {
        if (known.has(name.toLowerCase())) continue;
        ed.contents.push({ id: newId('c'), name, active: true });
        known.add(name.toLowerCase());
        added++;
      }
    }
    save();
    if (!flushSave()) return;
    toast(pl(added, 'circuit') + ' ajouté' + (added > 1 ? 's' : ''));
    location.hash = '#/jeux/' + game.id;
  });

  refresh();
  return h('div', { class: 'stack fade-in import-page' },
    h('a', { class: 'back-link', href: '#/jeux/' + game.id }, '← ' + game.name),
    h('h1', { class: 'page-title' }, 'Ajouter des circuits'),
    h('div', { class: 'import-layout' },
      h('section', { class: 'card card-pad-lg stack', 'aria-label': 'Liste des circuits' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Coller la liste'), ta),
        targetField,
        h('details', { class: 'draw-options' }, h('summary', {}, 'Depuis un fichier'),
          h('div', { class: 'stack' }, fileInput,
            h('p', { class: 'sub' }, 'Txt : un circuit par ligne · CSV : première colonne · JSON : liste de noms ou { editions: [{ name, contents }] }.'))),
        h('details', { class: 'draw-options' }, h('summary', {}, 'Préparer la liste avec une IA'),
          h('div', { class: 'stack' },
            h('p', { class: 'sub' }, prompt),
            h('button', {
              class: 'btn btn-outline btn-block', 'data-testid': 'button-open-ai',
              onclick: () => {
                const w = window.open('https://www.perplexity.ai/search?q=' + encodeURIComponent(prompt), '_blank');
                if (!w) toast('Ouverture bloquée par le navigateur', 'err');
              },
            }, 'Ouvrir dans Perplexity'),
            h('p', { class: 'sub' }, 'Collez ensuite la réponse dans la liste ci-dessus.')))),
      h('section', { class: 'card card-pad-lg stack import-review', 'aria-label': 'Aperçu avant import' },
        h('h2', { class: 'section-title' }, 'Aperçu'),
        h('p', { class: 'sub' }, 'Retirez les erreurs. Rien n\u2019est ajouté avant le clic sur Importer.'),
        previewBox, importBtn)));
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
    }, 'Par soirée')
  );

  let body;
  if (mode === 'alltime') {
    const stats = allTimeStats(st.sessions, st.players);
    const playerById = Object.fromEntries(st.players.map((p) => [p.id, p]));
    body = stats.length
      ? h('div', { class: 'stack' },
          stats.map((row) => {
            const p = playerById[row.pid];
            if (!p) return null;
            return h('div', { class: 'rank-row' + (row.rank === 1 ? ' first' : '') },
              h('span', { class: 'rank-pos' }, String(row.rank)),
              avatarEl(p),
              h('div', { style: 'flex:1;min-width:0' },
                h('div', { style: 'font-weight:600' }, p.name),
                h('div', { class: 'rank-sub' }, pl(row.wins, 'victoire') + ' · ' + pl(row.podiums, 'podium') + ' · ' + pl(row.gps, 'GP'))
              ),
              h('span', { class: 'rank-pts' }, row.pts + ' pts')
            );
          })
        )
      : h('p', { class: 'sub' }, 'Saisissez une première course pour alimenter le classement.');
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
                  h('span', { class: 'sub' }, fmtDate(s.date))
                )
              ),
              h('div', { class: 'accord-body stack' },
                ranking.length
                  ? ranking.map((row) => h('div', { class: 'rank-row' + (row.rank === 1 ? ' first' : '') },
                      h('span', { class: 'rank-pos' }, String(row.rank)),
                      playerById[row.pid] ? avatarEl(playerById[row.pid]) : null,
                      h('span', { style: 'font-weight:600' }, playerById[row.pid] ? playerById[row.pid].name : '?'),
                      h('span', { class: 'rank-pts' }, row.pts + ' pts')
                    ))
                  : h('p', { class: 'sub' }, 'Aucun Grand Prix.')
              )
            );
          })
        )
      : h('p', { class: 'sub' }, 'Aucune soirée pour l\u2019instant.');
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
        h('p', { class: 'sub' }, 'Les points comptent dès qu\u2019une course est saisie.')
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
    // Autant de places que le jeu qui compte le plus de pilotes (0 point par défaut).
    const places = Math.max(st.settings.bareme.length, ...st.games.filter((g) => !g.archived).map(racersFor));
    while (st.settings.bareme.length < places) st.settings.bareme.push(0);
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
            toast('Barème mis à jour pour les prochains Grands Prix');
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
    GamesSection(),
    h('div', { class: 'card card-pad-lg stack' },
      h('h2', { class: 'section-title' }, 'Application'),
      h('p', { class: 'sub', 'data-testid': 'app-version' }, 'Version ' + APP_VERSION),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Nom affiché'), nameInput),
      h('p', { class: 'sub' }, 'Thème : utilisez l\u2019icône lune/soleil dans l\u2019en-tête. L\u2019app suit le réglage de votre appareil par défaut.')
    ),
    h('div', { class: 'card card-pad-lg stack' },
      h('h2', { class: 'section-title' }, 'Barème par position'),
      h('p', { class: 'sub' }, 'Points par place réelle, bots compris. Chaque Grand Prix garde le barème en vigueur à sa création.'),
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
          message: 'Soirées, résultats, jeux personnalisés et joueurs seront supprimés. Les jeux préchargés seront rétablis. Cette action est irréversible.',
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
      'Application non officielle, sans affiliation avec Nintendo. Mario Kart est une marque de Nintendo. Les listes de circuits préchargées sont indicatives et modifiables.')
  );
}
