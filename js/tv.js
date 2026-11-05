// ============================================================
// Mode grand écran : affichage plein écran d'une soirée, lisible de loin,
// pour une télé, un vidéoprojecteur ou une tablette posée sur la table.
// Lecture seule ; se met à jour quand une autre fenêtre saisit une course.
// ============================================================

import { h, avatarEl } from './ui.js';
import { findSession, lastSession, getPlayers, refreshFromStorage } from './store.js';
import {
  gpStandings, gpFinished, raceComplete, raceWinners, pointsFor, sessionRanking, gpTitle, gpHighlights, teamStandings,
} from './engine.js';
import { raceGame, gameStyle, gamePill, ICONS } from './race-visuals.js';
import { factIconSvg } from './share.js';

export const TV_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
const FULL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const WINDOW_NAME = 'mkp-ecran';

export const tvUrl = (session) => '#/ecran/' + session.id;

// Sur ordinateur, le grand écran s'ouvre dans une fenêtre à part (à glisser sur la télé) ;
// sur téléphone et tablette, il remplace la page.
export function openTv(session) {
  const wide = matchMedia('(min-width: 1024px) and (pointer: fine)').matches;
  if (wide) {
    const win = window.open(location.pathname + tvUrl(session), WINDOW_NAME, 'popup,width=1280,height=720');
    if (win) { win.focus(); return; }
  }
  location.hash = tvUrl(session);
}

const pts = (n) => n + ' pt' + (n > 1 ? 's' : '');

function currentGp(session) {
  const n = session.playerIds.length;
  return session.grandPrix.slice().reverse().find((gp) => !gpFinished(gp, n)) || session.grandPrix.at(-1) || null;
}

export function TvView(sessionId) {
  const root = h('div', { class: 'tv', 'data-testid': 'tv-view' });
  let wakeLock = null;
  let idleTimer = null;
  let lastSignature = '';

  const requestWake = async () => {
    try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); }
    catch { /* refusé : l'écran pourra se mettre en veille */ }
  };
  const showControls = () => {
    root.classList.remove('is-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => root.classList.add('is-idle'), 3000);
  };
  const onStorage = () => { if (refreshFromStorage()) draw(); };
  const onVisible = () => { if (document.visibilityState === 'visible') { onStorage(); requestWake(); } };
  const poll = setInterval(() => {
    if (!root.isConnected) return cleanup();
    onStorage();
  }, 2500);
  function cleanup() {
    clearInterval(poll); clearTimeout(idleTimer);
    window.removeEventListener('storage', onStorage);
    document.removeEventListener('visibilitychange', onVisible);
    document.removeEventListener('pointermove', showControls);
    wakeLock?.release?.().catch(() => {});
  }
  window.addEventListener('storage', onStorage);
  document.addEventListener('visibilitychange', onVisible);
  document.addEventListener('pointermove', showControls);
  requestWake();

  const exit = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (window.name === WINDOW_NAME && window.opener) { window.close(); return; }
    location.hash = '#/session/' + (findSession(sessionId)?.id || '');
  };
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const controls = h('div', { class: 'tv-controls' },
    h('button', { class: 'tv-ctrl', 'aria-label': 'Plein écran', title: 'Plein écran', 'data-testid': 'button-tv-fullscreen', onclick: toggleFull, html: FULL_ICON }),
    h('button', { class: 'tv-ctrl', 'aria-label': 'Quitter le grand écran', title: 'Quitter', 'data-testid': 'button-tv-exit', onclick: exit, html: CLOSE_ICON }));

  // Positions affichées au dernier rendu, pour animer les dépassements.
  const flip = () => {
    const before = new Map([...root.querySelectorAll('[data-pid]')].map((el) => [el.dataset.key, el.getBoundingClientRect().top]));
    return () => root.querySelectorAll('[data-pid]').forEach((el) => {
      const prev = before.get(el.dataset.key);
      if (prev == null) return;
      const dy = prev - el.getBoundingClientRect().top;
      if (!dy) return;
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)' });
    });
  };

  function draw() {
    const session = sessionId ? findSession(sessionId) : lastSession();
    if (!session) {
      root.replaceChildren(controls, h('div', { class: 'tv-empty' }, h('p', {}, 'Aucune soirée pour l’instant.')));
      return;
    }
    const players = getPlayers(session.playerIds);
    const gp = currentGp(session);
    const signature = JSON.stringify([session.playerIds, session.grandPrix.map((g) => [g.id, g.name, g.races, g.teams])]);
    if (signature === lastSignature) return;
    lastSignature = signature;
    const animate = flip();

    if (!gp) {
      root.replaceChildren(controls,
        header(session, null, players),
        h('main', { class: 'tv-main is-single' }, sessionPanel(session, players, { big: true }),
          h('p', { class: 'tv-wait' }, 'En attente du premier Grand Prix…')));
      animate();
      return;
    }
    const finished = gpFinished(gp, players.length);
    root.replaceChildren(controls,
      header(session, gp, players),
      finished
        ? h('main', { class: 'tv-main is-finished' }, podium(gp, players), h('div', { class: 'tv-side' }, factsPanel(gp, players), teamsPanel(gp, players) || sessionPanel(session, players)))
        : h('main', { class: 'tv-main' }, tower(gp, players), h('div', { class: 'tv-side' }, racePanel(gp, players), teamsPanel(gp, players) || sessionPanel(session, players))),
      track(gp, players));
    animate();
  }

  function header(session, gp, players) {
    const n = gp ? session.grandPrix.indexOf(gp) + 1 : 0;
    const done = gp ? gp.races.filter((r) => raceComplete(r, players.length)).length : 0;
    const finished = gp && gpFinished(gp, players.length);
    return h('header', { class: 'tv-head' },
      h('div', { class: 'tv-title' },
        h('span', { class: 'tv-kicker' }, (gp ? 'GP ' + n + ' · ' : '') + session.name),
        h('h1', { class: 'tv-name', 'data-testid': 'tv-gp-name' }, gp ? gpTitle(session, gp) : session.name)),
      gp ? h('div', { class: 'tv-status' + (finished ? ' is-finished' : '') },
        finished ? h('span', { class: 'tv-status-big' }, 'Terminé')
          : [h('span', { class: 'tv-status-label' }, 'Course'),
             h('span', { class: 'tv-status-big', 'data-testid': 'tv-progress' }, Math.min(done + 1, gp.races.length) + '/' + gp.races.length)]) : null);
  }

  // Classement du GP en cours, façon tableau de chronométrage.
  function tower(gp, players) {
    const done = gp.races.filter((r) => raceComplete(r, players.length)).sort((a, b) => a.num - b.num);
    const lastRace = done.at(-1);
    const before = lastRace ? gpStandings({ ...gp, races: gp.races.filter((r) => r !== lastRace) }, players) : null;
    const prevRank = before ? Object.fromEntries(before.map((r) => [r.player.id, r.rank])) : {};
    const rows = gpStandings(gp, players);
    const leader = rows[0]?.points || 0;
    return h('section', { class: 'tv-tower' + (rows.length > 8 ? ' is-dense' : ''), 'aria-label': 'Classement du Grand Prix', style: '--rows:' + rows.length },
      h('div', { class: 'tv-tower-head' }, h('span', {}, 'Pos.'), h('span', {}, 'Pilote'), h('span', {}, 'Dernière'), h('span', {}, 'Écart'), h('span', {}, 'Pts')),
      h('ol', { class: 'tv-rows' }, rows.map((row, i) => {
        const gain = lastRace ? pointsFor(lastRace.results?.[row.player.id], gp.bareme) : null;
        const move = before ? prevRank[row.player.id] - row.rank : 0;
        return h('li', { class: 'tv-row' + (i === 0 ? ' is-first' : ''), 'data-pid': row.player.id, 'data-key': 't' + row.player.id, 'data-testid': 'tv-row-' + row.player.id },
          h('span', { class: 'tv-rank' }, String(row.rank)),
          h('span', { class: 'tv-stripe', style: 'background:' + row.player.color }),
          h('span', { class: 'tv-player' }, avatarEl(row.player, 40), h('span', { class: 'tv-pname' }, row.player.name),
            move ? h('span', { class: 'tv-move ' + (move > 0 ? 'is-up' : 'is-down'), 'aria-label': (move > 0 ? 'gagne ' : 'perd ') + Math.abs(move) + ' place(s)' },
              (move > 0 ? '▲' : '▼') + Math.abs(move)) : null),
          h('span', { class: 'tv-gain' }, gain != null ? '+' + gain : ''),
          h('span', { class: 'tv-gap' }, i === 0 ? '—' : '+' + (leader - row.points)),
          h('strong', { class: 'tv-pts' }, String(row.points)));
      })));
  }

  // Course en cours (ou la suivante) en très grand.
  function racePanel(gp, players) {
    const next = gp.races.find((r) => !raceComplete(r, players.length));
    const done = gp.races.filter((r) => raceComplete(r, players.length)).sort((a, b) => a.num - b.num);
    const lastRace = done.at(-1);
    const byId = Object.fromEntries(players.map((p) => [p.id, p]));
    const lastWinner = lastRace ? raceWinners(lastRace).map((pid) => byId[pid]?.name).filter(Boolean).join(' & ') : '';
    if (!next) return null;
    const game = raceGame(next, gp);
    return h('section', { class: 'tv-race', style: gameStyle(game), 'data-testid': 'tv-current-race' },
      h('span', { class: 'tv-label' }, 'Course ' + next.num + ' · à jouer'),
      h('p', { class: 'tv-race-name' }, next.contentName),
      gamePill(game),
      lastRace ? h('p', { class: 'tv-last' }, 'Dernière : ', h('strong', {}, lastRace.contentName), lastWinner ? ' · gagnée par ' + lastWinner : '') : null);
  }

  function podium(gp, players) {
    const rows = gpStandings(gp, players);
    const order = [rows[1], rows[0], rows[2]].filter(Boolean);
    return h('section', { class: 'tv-podium', 'data-testid': 'tv-podium' },
      order.map((row) => h('div', { class: 'tv-step is-' + Math.min(row.rank, 3), 'data-pid': row.player.id, 'data-key': 'p' + row.player.id },
        avatarEl(row.player, row.rank === 1 ? 120 : 92),
        h('span', { class: 'tv-step-name' }, row.player.name),
        h('span', { class: 'tv-step-pts' }, pts(row.points)),
        h('span', { class: 'tv-step-block' }, String(row.rank)))));
  }

  function factsPanel(gp, players) {
    const facts = gpHighlights(gp, players).filter((f) => f.key !== 'team').slice(0, 3);
    if (!facts.length) return null;
    return h('section', { class: 'tv-facts' },
      facts.map((f) => h('div', { class: 'tv-fact is-' + f.key, style: f.color ? '--fact:' + f.color : null },
        h('span', { class: 'tv-fact-icon', html: factIconSvg(f.key) }),
        h('span', {}, h('strong', {}, f.who || f.text), f.short ? ' ' + f.short : ''))));
  }

  // Classement des équipes de 2, à la place du classement de la soirée.
  function teamsPanel(gp, players) {
    const rows = teamStandings(gp, players);
    if (!rows.length) return null;
    return h('section', { class: 'tv-session tv-teams', 'aria-label': 'Classement des équipes', 'data-testid': 'tv-teams' },
      h('span', { class: 'tv-label' }, 'Équipes'),
      h('ol', {}, rows.map((r) => h('li', { 'data-pid': r.team.id, 'data-key': 'e' + r.team.id, style: '--team:' + r.team.color },
        h('span', { class: 'tv-srank' }, String(r.rank)),
        h('span', { class: 'team-duo' }, r.members.map((p) => avatarEl(p, 30))),
        h('span', { class: 'tv-sname' }, r.team.name.replace('Équipe ', ''),
          h('small', {}, r.members.map((p) => p.name).join(' & '))),
        h('strong', {}, String(r.points))))));
  }

  function sessionPanel(session, players, { big = false } = {}) {
    if (session.grandPrix.length < 2 && !big) return null;
    const byId = Object.fromEntries(players.map((p) => [p.id, p]));
    const rows = sessionRanking(session).slice(0, big ? 12 : 6);
    return h('section', { class: 'tv-session' + (big ? ' is-big' : ''), 'aria-label': 'Classement de la soirée' },
      h('span', { class: 'tv-label' }, 'Soirée · ' + session.grandPrix.length + ' GP'),
      h('ol', {}, rows.map((r) => byId[r.pid] && h('li', { 'data-pid': r.pid, 'data-key': 's' + r.pid },
        h('span', { class: 'tv-srank' }, String(r.rank)), avatarEl(byId[r.pid], 30),
        h('span', { class: 'tv-sname' }, byId[r.pid].name), h('strong', {}, String(r.pts)))).filter(Boolean)));
  }

  // Piste horizontale : un arrêt par course, le kart sur la course à jouer.
  function track(gp, players) {
    const byId = Object.fromEntries(players.map((p) => [p.id, p]));
    const next = gp.races.find((r) => !raceComplete(r, players.length));
    return h('footer', { class: 'tv-track', style: '--stops:' + gp.races.length, 'aria-label': 'Courses du Grand Prix' },
      h('div', { class: 'tv-road', 'aria-hidden': 'true' }),
      h('ol', {}, gp.races.map((race) => {
        const done = raceComplete(race, players.length);
        const isNext = race === next;
        const winner = done ? byId[raceWinners(race)[0]] : null;
        return h('li', { class: 'tv-stop' + (done ? ' is-done' : '') + (isNext ? ' is-next' : ''), style: gameStyle(raceGame(race, gp)) },
          h('span', { class: 'tv-node' }, isNext ? h('span', { class: 'tv-kart', html: ICONS.kart }) : String(race.num)),
          h('span', { class: 'tv-stop-name' }, race.contentName),
          winner ? h('span', { class: 'tv-stop-win' }, avatarEl(winner, 22), winner.name) : null);
      })),
      h('span', { class: 'tv-flag', 'aria-hidden': 'true' }));
  }

  draw();
  showControls();
  return root;
}
