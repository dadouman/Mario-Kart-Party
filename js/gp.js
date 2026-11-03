// ============================================================
// Page Grand Prix : bandeau de classement, piste des courses,
// saisie par grille des places et récap de fin de GP.
// ============================================================

import { getState, save, flushSave, findSession, getPlayers } from './store.js';
import { h, toast, confirmModal, avatarEl } from './ui.js';
import {
  raceComplete, gpStandings, gpFinished, pointsFor, raceWinners,
  sessionRankingDelta, gpHighlights, ordinal,
} from './engine.js';
import { startGrandPrix, replaceRace } from './draw.js';
import { raceGame, gameStyle, gamePill, racersFor } from './race-visuals.js';
import { NotFound } from './views.js';

export const gpUrl = (session, gp) => '#/session/' + session.id + '/gp/' + gp.id;

// Lance un nouveau GP dans la soirée et ouvre directement sa page.
export function launchGp(session) {
  const gp = startGrandPrix(getState(), session);
  if (!gp || !flushSave()) return;
  location.hash = gpUrl(session, gp);
}

const svg = (markup) => h('span', { class: 'gp-icon', 'aria-hidden': 'true', html: markup });
// Kart vu du dessus, roulant vers le bas de la piste.
const KART = '<svg viewBox="0 0 32 40"><rect x="2" y="6" width="7" height="10" rx="2" class="k-wheel"/><rect x="23" y="6" width="7" height="10" rx="2" class="k-wheel"/><rect x="2" y="25" width="7" height="10" rx="2" class="k-wheel"/><rect x="23" y="25" width="7" height="10" rx="2" class="k-wheel"/><path d="M8 4h16l3 10v14l-4 9H9l-4-9V14z" class="k-body"/><circle cx="16" cy="17" r="5.5" class="k-helmet"/><rect x="10" y="30" width="12" height="3" rx="1.5" class="k-bumper"/></svg>';
const REROLL = '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

export function GpView(sessionId, gpId, requestedRaceNum = null) {
  const session = findSession(sessionId);
  const gp = session && session.grandPrix.find((g) => g.id === gpId);
  if (!gp) return NotFound();

  const st = getState();
  const players = getPlayers(session.playerIds);
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  const gpNumber = session.grandPrix.indexOf(gp) + 1;
  const isDone = (race) => raceComplete(race, players.length);
  const firstOpen = () => gp.races.find((r) => !isDone(r));

  let active = gp.races.some((r) => r.num === requestedRaceNum) ? requestedRaceNum : firstOpen()?.num ?? null;
  let doneOpen = active != null && isDone(gp.races.find((r) => r.num === active));
  let selPlace = null;
  let selPlayer = null;
  let advanceTimer = null;
  let celebrated = gpFinished(gp, players.length);

  // ---------- En-tête et menu « … » ----------
  const menu = h('div', { class: 'gp-menu', hidden: true, role: 'menu' },
    h('button', {
      class: 'gp-menu-item is-danger', role: 'menuitem', 'data-testid': 'button-cancel-gp',
      onclick: () => {
        menu.hidden = true;
        confirmModal({
          title: 'Supprimer ce Grand Prix ?',
          message: 'Ses courses et ses points seront retirés de la soirée.',
          confirmLabel: 'Supprimer', danger: true,
          onConfirm: () => {
            session.grandPrix = session.grandPrix.filter((g) => g.id !== gp.id);
            save();
            toast('Grand Prix supprimé');
            location.hash = '#/session/' + sessionId;
          },
        });
      },
    }, 'Supprimer le Grand Prix'));
  const menuBtn = h('button', {
    class: 'gp-menu-btn', 'aria-label': 'Plus d’actions', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    'data-testid': 'button-gp-menu',
    onclick: (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      menuBtn.setAttribute('aria-expanded', String(!menu.hidden));
    },
  }, '…');
  const closeMenu = (e) => {
    if (!view.isConnected) { document.removeEventListener('click', closeMenu); return; }
    if (!menu.hidden && !menu.contains(e.target)) { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); }
  };
  document.addEventListener('click', closeMenu);
  const header = h('header', { class: 'gp-head' },
    h('a', { class: 'back-link', href: '#/session/' + sessionId }, '← ' + session.name),
    h('div', { class: 'gp-head-row' },
      h('h1', { class: 'page-title' }, 'Grand Prix ' + gpNumber),
      h('div', { class: 'gp-menu-wrap' }, menuBtn, menu)));

  const bar = h('div', { class: 'gp-bar', 'data-testid': 'gp-live-ranking', 'aria-label': 'Classement du Grand Prix' });
  const trackBox = h('div', { class: 'gp-track-box' });
  const recapBox = h('div', { class: 'gp-recap-box' });

  // ---------- Bandeau de classement ----------
  function renderBar() {
    const doneCount = gp.races.filter(isDone).length;
    bar.replaceChildren(
      h('ol', { class: 'gp-bar-list' },
        gpStandings(gp, players).map((row) => h('li', { class: 'gp-bar-item' + (row.rank === 1 ? ' is-first' : '') },
          h('span', { class: 'gp-bar-rank' }, String(row.rank)),
          avatarEl(row.player, 22),
          h('span', { class: 'gp-bar-name' }, row.player.name),
          h('strong', { class: 'gp-bar-pts' }, String(row.points))))),
      h('span', { class: 'gp-bar-count', 'aria-label': doneCount + ' courses sur ' + gp.races.length },
        doneCount + '/' + gp.races.length));
  }

  // ---------- Piste ----------
  function stop(race, { done }) {
    const game = raceGame(race, gp);
    const open = race.num === active;
    const winners = done ? raceWinners(race).map((pid) => byId[pid]?.name).filter(Boolean) : [];
    const node = open
      ? h('span', { class: 'gp-node is-kart' }, svg(KART), h('span', { class: 'gp-node-num' }, String(race.num)))
      : done ? h('span', { class: 'gp-node is-done' }, svg(CHECK))
      : h('span', { class: 'gp-node' }, String(race.num).padStart(2, '0'));
    const headBtn = h('button', {
      class: 'gp-stop-head', 'data-testid': 'race-' + race.num,
      'aria-expanded': String(open), 'aria-label': 'Course ' + race.num + ' : ' + race.contentName + ', ' + game.name,
      onclick: () => { clearTimeout(advanceTimer); setActive(open ? null : race.num); },
    },
      h('span', { class: 'gp-stop-name' }, race.contentName),
      gamePill(game),
      winners.length && !open ? h('span', { class: 'gp-stop-winner' }, winners.join(', ')) : null);
    const replaceBtn = open && !Object.keys(race.results || {}).length ? h('button', {
      class: 'gp-reroll', 'aria-label': 'Changer de circuit', title: 'Changer de circuit',
      'data-testid': 'button-replace-race-' + race.num,
      onclick: () => {
        if (replaceRace(st, gp, race)) { toast('Nouveau circuit : ' + race.contentName); rerender(); }
      },
    }, svg(REROLL)) : null;
    return h('li', {
      class: 'gp-stop' + (open ? ' is-open' : '') + (done ? ' is-done' : ''),
      style: gameStyle(game), 'data-race': race.num,
    },
      h('div', { class: 'gp-road', 'aria-hidden': 'true' }, node),
      h('div', { class: 'gp-stop-card' },
        h('div', { class: 'gp-stop-top' }, headBtn, replaceBtn),
        open ? editor(race) : null));
  }

  function renderTrack() {
    const doneRaces = gp.races.filter(isDone);
    const upcoming = gp.races.filter((r) => !isDone(r));
    let doneBlock = null;
    if (doneRaces.length) {
      doneBlock = h('details', { class: 'gp-done', open: doneOpen, 'data-testid': 'gp-done' },
        h('summary', {},
          h('span', { class: 'gp-road is-travelled', 'aria-hidden': 'true' },
            h('span', { class: 'gp-node is-done' }, svg(CHECK))),
          h('span', { class: 'gp-done-label' },
            doneRaces.length + (doneRaces.length > 1 ? ' courses saisies' : ' course saisie')),
          h('span', { class: 'gp-done-mark', 'aria-hidden': 'true' }, '⌄')),
        h('ol', { class: 'gp-track' }, doneRaces.map((r) => stop(r, { done: true }))));
      doneBlock.addEventListener('toggle', () => { doneOpen = doneBlock.open; });
    }
    trackBox.replaceChildren(...[
      doneBlock,
      upcoming.length ? h('ol', { class: 'gp-track', 'aria-label': 'Courses à venir' },
        upcoming.map((r) => stop(r, { done: false }))) : null,
      h('div', { class: 'gp-finish' + (upcoming.length ? '' : ' is-reached') },
        h('span', { class: 'gp-finish-flag', 'aria-hidden': 'true' }), 'Arrivée'),
    ].filter(Boolean));
  }

  // ---------- Saisie par grille des places ----------
  function editor(race) {
    race.results = race.results || {};
    const racers = Math.max(racersFor(raceGame(race, gp)), players.length);
    const occupant = (pos) => Object.keys(race.results).find((pid) => race.results[pid]?.pos === pos);
    const unplaced = players.filter((p) => typeof race.results[p.id]?.pos !== 'number');

    const hint = selPlace ? 'Qui finit ' + ordinal(selPlace) + ' ?' :
      selPlayer ? 'Où finit ' + byId[selPlayer].name + ' ?' :
      unplaced.length ? 'Touchez une place, puis le joueur' : 'Course complète';

    const chips = h('div', { class: 'gp-chips' }, players.map((p) => {
      const pos = race.results[p.id]?.pos;
      return h('button', {
        class: 'gp-chip' + (selPlayer === p.id ? ' is-selected' : '') + (typeof pos === 'number' ? ' is-placed' : ''),
        style: '--player:' + p.color, 'data-testid': 'chip-player-' + p.id,
        'aria-pressed': String(selPlayer === p.id),
        onclick: () => onPlayer(race, p.id),
      }, avatarEl(p, 24), h('span', { class: 'gp-chip-name' }, p.name),
        h('span', { class: 'gp-chip-pos' }, typeof pos === 'number' ? ordinal(pos) : '?'));
    }));

    const grid = h('div', { class: 'gp-grid' + (racers > 12 ? ' is-wide' : ''), role: 'group', 'aria-label': 'Places de la course' },
      Array.from({ length: racers }, (_, i) => {
        const pos = i + 1;
        const pid = occupant(pos);
        const player = pid && byId[pid];
        return h('button', {
          class: 'gp-cell' + (player ? ' is-taken' : '') + (selPlace === pos ? ' is-selected' : '') +
            (player && selPlayer === pid ? ' is-moving' : ''),
          style: player ? '--player:' + player.color : null,
          'data-testid': 'place-' + race.num + '-' + pos,
          'aria-label': ordinal(pos) + (player ? ' : ' + player.name : ' : libre'),
          onclick: () => onPlace(race, pos),
        },
          h('span', { class: 'gp-cell-pos' }, String(pos)),
          player ? h('span', { class: 'gp-cell-who' }, player.name.slice(0, 3))
            : h('span', { class: 'gp-cell-pts' }, String(pointsFor({ pos }, gp.bareme)) + ' pts'));
      }));

    return h('div', { class: 'gp-editor' },
      h('p', { class: 'gp-hint', role: 'status', 'aria-live': 'polite' }, hint),
      chips, grid);
  }

  function onPlayer(race, pid) {
    if (selPlace) return assign(race, pid, selPlace);
    selPlayer = selPlayer === pid ? null : pid;
    rerender();
  }

  function onPlace(race, pos) {
    const pid = Object.keys(race.results).find((id) => race.results[id]?.pos === pos);
    // Une place prise : premier appui = déplacer ce joueur, second appui = le retirer.
    if (pid && selPlayer === pid) {
      delete race.results[pid];
      selPlayer = null;
      save();
      return rerender();
    }
    if (selPlayer) return assign(race, selPlayer, pos);
    if (pid) { selPlayer = pid; selPlace = null; return rerender(); }
    const unplaced = players.filter((p) => typeof race.results[p.id]?.pos !== 'number');
    if (unplaced.length === 1) return assign(race, unplaced[0].id, pos);
    selPlace = selPlace === pos ? null : pos;
    rerender();
  }

  function assign(race, pid, pos) {
    const wasDone = isDone(race);
    const snapshot = JSON.parse(JSON.stringify(race.results));
    for (const id of Object.keys(race.results)) if (race.results[id]?.pos === pos) delete race.results[id];
    race.results[pid] = { pos };
    selPlace = null;
    selPlayer = null;
    save();
    if (!wasDone && isDone(race)) return completeRace(race, snapshot);
    rerender();
  }

  function completeRace(race, snapshot) {
    if (!flushSave()) toast('Sauvegarde impossible sur cet appareil. Vos saisies restent dans cet onglet.', 'err');
    const next = gp.races.find((r) => r.num > race.num && !isDone(r)) || firstOpen();
    rerender();
    toast('Course ' + race.num + ' enregistrée', '', {
      duration: 5000,
      action: {
        label: 'Annuler',
        onClick: () => {
          clearTimeout(advanceTimer);
          race.results = snapshot;
          save();
          doneOpen = false;
          setActive(race.num);
        },
      },
    });
    clearTimeout(advanceTimer);
    advanceTimer = setTimeout(() => {
      if (!view.isConnected) return;
      doneOpen = false;
      setActive(next?.num ?? null);
      if (!next) recapBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 700);
  }

  function setActive(num, scroll = true) {
    active = num;
    selPlace = null;
    selPlayer = null;
    const race = gp.races.find((r) => r.num === num);
    if (race && isDone(race)) doneOpen = true;
    rerender();
    if (scroll && num != null) {
      view.querySelector('.gp-stop[data-race="' + num + '"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // ---------- Récap de fin de GP ----------
  function renderRecap() {
    const finished = gpFinished(gp, players.length);
    if (!finished) { recapBox.replaceChildren(); return; }
    const standings = gpStandings(gp, players);
    const podiumRows = standings.slice(0, 3);
    const order = podiumRows.length === 3 ? [1, 0, 2] : podiumRows.length === 2 ? [1, 0] : [0];
    const animate = !celebrated;
    celebrated = true;

    const podium = h('div', { class: 'recap-podium' + (animate ? ' is-animated' : ''), 'aria-label': 'Podium du Grand Prix' },
      h('div', { class: 'recap-confetti', 'aria-hidden': 'true' },
        Array.from({ length: 18 }, (_, i) => h('span', { style: '--i:' + i }))),
      order.map((index) => {
        const row = podiumRows[index];
        return h('div', { class: 'recap-step tier-' + Math.min(row.rank, 3), style: '--delay:' + (2 - index) * 0.18 + 's' },
          avatarEl(row.player, 52),
          h('span', { class: 'recap-name' }, row.player.name),
          h('span', { class: 'recap-pts' }, row.points + ' pts'),
          h('div', { class: 'recap-block' }, h('span', {}, String(row.rank))));
      }));
    const rest = standings.slice(3);

    const facts = gpHighlights(gp, players);
    const delta = sessionRankingDelta(session, gp.id);
    const showDelta = gpNumber > 1;

    recapBox.replaceChildren(h('section', { class: 'gp-recap', 'data-testid': 'gp-completion', 'aria-label': 'Récap du Grand Prix' },
      h('h2', { class: 'recap-title' }, 'Grand Prix ' + gpNumber + ' terminé'),
      podium,
      rest.length ? h('ol', { class: 'recap-rest' }, rest.map((row) => h('li', {},
        h('span', { class: 'rank-pos' }, String(row.rank)), avatarEl(row.player, 22),
        h('span', { class: 'recap-rest-name' }, row.player.name), h('strong', {}, row.points + ' pts')))) : null,
      facts.length ? h('div', { class: 'recap-facts' }, facts.map((f) => h('div', { class: 'recap-fact is-' + f.key },
        h('span', { class: 'recap-fact-title' }, f.title), h('span', { class: 'recap-fact-text' }, f.text)))) : null,
      h('div', { class: 'recap-session' },
        h('h3', {}, 'Classement de la soirée'),
        h('ol', { class: showDelta ? 'has-trend' : '' }, delta.map((row) => {
          const p = byId[row.pid];
          if (!p) return null;
          const trend = !showDelta ? null : row.delta === 0 ? h('span', { class: 'trend is-flat', 'aria-label': 'Rang inchangé' }, '=') :
            row.delta > 0 ? h('span', { class: 'trend is-up', 'aria-label': 'Gagne ' + row.delta + ' place(s)' }, '▲' + row.delta) :
            h('span', { class: 'trend is-down', 'aria-label': 'Perd ' + -row.delta + ' place(s)' }, '▼' + -row.delta);
          return h('li', {}, h('span', { class: 'rank-pos' }, String(row.rank)), avatarEl(p, 22),
            h('span', { class: 'recap-rest-name' }, p.name), trend, h('strong', {}, row.pts + ' pts'));
        }))),
      h('button', { class: 'btn btn-primary btn-block', 'data-testid': 'button-next-gp', onclick: () => launchGp(session) },
        'Grand Prix suivant')));
  }

  function rerender() {
    renderBar();
    renderTrack();
    renderRecap();
  }

  const view = h('div', { class: 'fade-in gp-page' }, header, bar, trackBox, recapBox);
  rerender();
  if (active != null && gp.races.some((r) => r.num < active || isDone(r))) {
    requestAnimationFrame(() => view.querySelector('.gp-stop.is-open')?.scrollIntoView({ block: 'start', behavior: 'instant' }));
  }
  return view;
}

// Compatibilité avec les anciens liens : même écran, course demandée ouverte.
export function RaceView(sessionId, gpId, raceNum) {
  const session = findSession(sessionId);
  const gp = session && session.grandPrix.find((g) => g.id === gpId);
  if (!gp || !gp.races.some((r) => r.num === raceNum)) return NotFound();
  return GpView(sessionId, gpId, raceNum);
}
