// ============================================================
// Page Grand Prix : bandeau de classement, piste des courses,
// saisie par grille des places et récap de fin de GP.
// ============================================================

import { getState, save, flushSave, findSession, getPlayers } from './store.js';
import { h, toast, confirmModal, avatarEl, moreMenu } from './ui.js';
import {
  raceComplete, gpStandings, gpFinished, pointsFor, raceWinners,
  sessionRankingDelta, gpHighlights, ordinal, gpTitle,
} from './engine.js';
import { startGrandPrix, replaceRace, renameGp } from './draw.js';
import { raceGame, gameStyle, gamePill, racersFor, icon, rerollButton } from './race-visuals.js';
import { NotFound } from './views.js';
import { openShare, SHARE_ICON } from './share.js';

export const gpUrl = (session, gp) => '#/session/' + session.id + '/gp/' + gp.id;

// Lance un nouveau GP dans la soirée et ouvre directement sa page.
export function launchGp(session) {
  const gp = startGrandPrix(getState(), session);
  if (!gp || !flushSave()) return;
  location.hash = gpUrl(session, gp);
}

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
  const menu = moreMenu([{
    label: 'Supprimer le Grand Prix', danger: true, testid: 'button-cancel-gp',
    onClick: () => confirmModal({
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
  }], { testid: 'button-gp-menu' });
  const header = h('header', { class: 'gp-head' },
    h('a', { class: 'back-link', href: '#/session/' + sessionId }, '← ' + session.name),
    h('div', { class: 'gp-head-row' },
      h('div', { class: 'gp-title-wrap' },
        h('span', { class: 'gp-num' }, 'GP ' + gpNumber),
        h('h1', { class: 'page-title gp-name', 'data-testid': 'gp-name' }, gpTitle(session, gp))),
      rerollButton(() => {
        renameGp(session, gp);
        header.querySelector('.gp-name').textContent = gpTitle(session, gp);
        renderRecap();
      }, 'button-rename-gp', 'Changer de nom'),
      menu));

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
      ? h('span', { class: 'gp-node is-kart' }, icon('kart'), h('span', { class: 'gp-node-num' }, String(race.num)))
      : done ? h('span', { class: 'gp-node is-done' }, icon('check'))
      : h('span', { class: 'gp-node' }, String(race.num).padStart(2, '0'));
    const headBtn = h('button', {
      class: 'gp-stop-head', 'data-testid': 'race-' + race.num,
      'aria-expanded': String(open), 'aria-label': 'Course ' + race.num + ' : ' + race.contentName + ', ' + game.name,
      onclick: () => { clearTimeout(advanceTimer); setActive(open ? null : race.num); },
    },
      h('span', { class: 'gp-stop-name' }, race.contentName),
      gamePill(game),
      winners.length && !open ? h('span', { class: 'gp-stop-winner' }, winners.join(', ')) : null);
    const replaceBtn = open && !Object.keys(race.results || {}).length ? rerollButton(() => {
      if (replaceRace(st, gp, race)) { toast('Nouveau circuit : ' + race.contentName); rerender(); }
    }, 'button-replace-race-' + race.num) : null;
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
            h('span', { class: 'gp-node is-done' }, icon('check'))),
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
      h('p', { class: 'recap-kicker' }, 'GP ' + gpNumber + ' terminé'),
      h('h2', { class: 'recap-title' }, gpTitle(session, gp)),
      podium,
      rest.length ? h('ol', { class: 'recap-rest' }, rest.map((row) => h('li', {},
        h('span', { class: 'rank-pos' }, String(row.rank)), avatarEl(row.player, 22),
        h('span', { class: 'recap-rest-name' }, row.player.name), h('strong', {}, row.points + ' pts')))) : null,
      h('button', { class: 'btn btn-outline btn-block share-btn', 'data-testid': 'button-share-gp',
        onclick: (e) => { e.currentTarget.disabled = true; const b = e.currentTarget;
          openShare({ session, gp, players }).finally(() => { b.disabled = false; }); } },
        h('span', { class: 'gp-icon', 'aria-hidden': 'true', html: SHARE_ICON }), 'Partager le résultat'),
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
