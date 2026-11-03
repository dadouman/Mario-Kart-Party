// ============================================================
// Partage du résultat d'un GP : carte image au format story (1080×1920)
// et message prêt à coller dans un groupe.
// ============================================================

import { h, modal, toast } from './ui.js';
import { gpStory, gpHighlights, raceWinners } from './engine.js';

const W = 1080;
const H = 1920;
const DISPLAY = 'Chillax, "General Sans", sans-serif';
const BODY = '"General Sans", system-ui, sans-serif';

// Icônes des faits marquants (traits, grille 24×24), communes à la carte et au récap.
export const FACT_ICONS = {
  wins: 'M3 18h18M4 18 3 7l5 4 4-7 4 7 5-4-1 11',
  last: 'M9 3h6M12 3v3M8 6h8l2 3v8l-2 3H8l-2-3V9zM10 11h4M10 15h4',
  comeback: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  tight: 'M9 2h6M12 2v3M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v5l3 2',
};
export const FACT_COLORS = { wins: '#e9a800', last: '#e5402b', comeback: '#1d9a4d', tight: '#1597b0' };
export const factIconSvg = (key) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${FACT_ICONS[key] || FACT_ICONS.wins}"/></svg>`;

function factBadge(ctx, key, cx, cy, size) {
  ctx.save();
  ctx.fillStyle = FACT_COLORS[key] || INK;
  ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, Math.PI * 2); ctx.fill();
  const k = (size * 0.62) / 24;
  ctx.translate(cx - 12 * k, cy - 12 * k); ctx.scale(k, k);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(FACT_ICONS[key] || FACT_ICONS.wins));
  ctx.restore();
}

export const SHARE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>';

export function appUrl() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

async function fontsReady() {
  if (!document.fonts?.load) return;
  const loads = ['700 120px Chillax', '600 40px Chillax', '600 40px "General Sans"', '500 40px "General Sans"']
    .map((f) => document.fonts.load(f).catch(() => null));
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 1500))]);
}

function fitFont(ctx, text, weight, max, family, maxWidth) {
  let size = max;
  do { ctx.font = `${weight} ${size}px ${family}`; size -= 4; } while (ctx.measureText(text).width > maxWidth && size > 24);
}

function ellipsis(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

function roundRect(ctx, x, y, w, hgt, r) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, hgt, r) : ctx.rect(x, y, w, hgt);
}



// Petit générateur pseudo-aléatoire : la carte d'un GP reste identique.
function seeded(seed) {
  let x = [...String(seed)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 2166136261) || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 10000) / 10000; };
}

const INK = '#1d1b2e';
const PAPER = '#f4ecdc';
const RED = '#e5402b';
const YELLOW = '#f5c23e';


// Tampon encreur, légèrement penché et irrégulier.
function stamp(ctx, text, cx, cy, rnd) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(0.21);
  ctx.globalAlpha = 0.88;
  ctx.strokeStyle = RED; ctx.fillStyle = RED;
  ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(0, 0, 118, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 100, 0, Math.PI * 2); ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 22px ${BODY}`;
  ctx.fillText('OFFICIEL', 0, -48);
  fitFont(ctx, text.toUpperCase(), 700, 40, DISPLAY, 160);
  ctx.fillText(text.toUpperCase(), 0, 4);
  ctx.font = `600 22px ${BODY}`;
  ctx.fillText('★  ★  ★', 0, 52);
  // Manques d'encre : quelques taches couleur papier.
  ctx.globalAlpha = 1; ctx.fillStyle = PAPER;
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2, d = rnd() * 125;
    ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, 1 + rnd() * 3.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function perforation(ctx, x0, x1, y) {
  ctx.fillStyle = RED;
  ctx.beginPath(); ctx.arc(x0, y, 26, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x1, y, 26, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(29,27,46,.35)'; ctx.lineWidth = 3; ctx.setLineDash([14, 12]);
  ctx.beginPath(); ctx.moveTo(x0 + 44, y); ctx.lineTo(x1 - 44, y); ctx.stroke();
  ctx.setLineDash([]);
}

// Dessine la carte et renvoie le canvas : un ticket de course imprimé.
export async function drawShareCard({ session, gp, players }) {
  await fontsReady();
  const story = gpStory(session, gp, players);
  const rnd = seeded(gp.id || story.gpNumber);
  const facts = gpHighlights(gp, players);
  const last = story.standings.at(-1);
  if (story.standings.length >= 3 && last.rank > 1 && story.standings.filter((r) => r.rank === last.rank).length === 1) {
    facts.push({ key: 'last', title: 'Lanterne rouge', who: last.player.name, short: 'lanterne rouge · ' + last.points + ' pts', text: last.player.name + ' · ' + last.points + ' pts' });
  }
  const order = ['wins', 'last', 'comeback', 'tight'];
  facts.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Fond rouge à rayures diagonales, à plat.
  ctx.fillStyle = RED; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.strokeStyle = '#d23722'; ctx.lineWidth = 34;
  for (let x = -H; x < W + H; x += 96) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + H, H); ctx.stroke(); }
  ctx.restore();

  // Le ticket, posé de travers, avec une ombre franche.
  const X0 = 70, X1 = 1010, Y0 = 140, Y1 = 1780, TW = X1 - X0;
  ctx.save();
  ctx.translate(W / 2, H / 2); ctx.rotate(-0.026); ctx.translate(-W / 2, -H / 2);
  ctx.fillStyle = INK; roundRect(ctx, X0 + 16, Y0 + 18, TW, Y1 - Y0, 18); ctx.fill();
  ctx.fillStyle = PAPER; roundRect(ctx, X0, Y0, TW, Y1 - Y0, 18); ctx.fill();
  ctx.save(); roundRect(ctx, X0, Y0, TW, Y1 - Y0, 18); ctx.clip();
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(29,27,46,.05)' : 'rgba(255,255,255,.35)';
    ctx.fillRect(X0 + rnd() * TW, Y0 + rnd() * (Y1 - Y0), 2, 2);
  }
  ctx.restore();

  const L = X0 + 60, R = X1 - 60;
  ctx.textBaseline = 'alphabetic';

  // En-tête du ticket.
  ctx.fillStyle = INK; ctx.textAlign = 'right'; ctx.font = `500 28px ${BODY}`;
  const num = 'GP N°' + String(story.gpNumber).padStart(2, '0');
  ctx.fillText(num, R, Y0 + 80);
  const numW = ctx.measureText(num).width;
  ctx.textAlign = 'left'; ctx.font = `700 30px ${BODY}`;
  ctx.fillText(ellipsis(ctx, story.title.toUpperCase(), R - L - numW - 30), L, Y0 + 80);
  ctx.fillRect(L, Y0 + 104, R - L, 5);

  ctx.textAlign = 'left';
  ctx.font = `600 30px ${BODY}`; ctx.fillStyle = 'rgba(29,27,46,.7)';
  ctx.fillText('Vainqueur', L, Y0 + 175);
  const leaders = story.standings.filter((r) => r.rank === 1);
  const winnerText = leaders.map((r) => r.player.name).join(' & ') || '—';
  fitFont(ctx, winnerText, 700, 150, DISPLAY, R - L - 240);
  ctx.fillStyle = RED; ctx.fillText(winnerText, L + 7, Y0 + 318 + 7);
  ctx.fillStyle = INK; ctx.fillText(winnerText, L, Y0 + 318);
  const first = story.standings[0];
  ctx.font = `500 36px ${BODY}`; ctx.fillStyle = INK;
  ctx.fillText(leaders.length > 1 ? 'à égalité, ' + first.points + ' pts chacun' : first ? first.points + ' pts au compteur' : '', L, Y0 + 380);
  stamp(ctx, story.kicker, R - 90, Y0 + 245, rnd);

  let y = Y0 + 450;
  perforation(ctx, X0, X1, y);

  // Mise en page adaptative : le top 6 reste lisible, les courses se tassent.
  const footerY = Y1 - 230;
  const limit = footerY - 34;
  const races = gp.races.filter((r) => Object.keys(r.results || {}).length);
  const total = story.standings.length;
  const shown = story.standings.slice(0, total <= 7 ? 7 : 6);
  const more = total - shown.length;
  const cols = races.length <= 8 ? 2 : races.length <= 15 ? 3 : 4;
  const courseRowH = cols === 2 ? 50 : cols === 3 ? 44 : 40;
  const coursesH = races.length ? 58 + Math.ceil(races.length / cols) * courseRowH : 0;
  const tableH = (big, row) => 30 + big + (shown.length - 1) * (row + 6) + 6 + (more ? 46 : 0);
  let bigH = 120, rowH = 88;
  const startY = y + 60;
  if (startY + tableH(bigH, rowH) + 20 + coursesH > limit) { bigH = 100; rowH = 72; }
  if (startY + tableH(bigH, rowH) + 20 + coursesH > limit) { bigH = 88; rowH = 62; }
  const rowFont = rowH >= 88 ? 44 : rowH >= 72 ? 38 : 34;

  // Classement façon tableau de chronométrage.
  y = startY;
  ctx.font = `700 24px ${BODY}`; ctx.fillStyle = 'rgba(29,27,46,.6)'; ctx.textAlign = 'left';
  ctx.fillText('POS.', L, y); ctx.fillText('PILOTE', L + 130, y);
  ctx.textAlign = 'right'; ctx.fillText('PTS', R, y); ctx.fillText('ÉCART', R - 150, y);
  y += 24;
  shown.forEach((row, i) => {
    const big = i === 0;
    const hgt = big ? bigH : rowH;
    if (big) { ctx.fillStyle = YELLOW; ctx.fillRect(L - 20, y, R - L + 40, hgt); }
    else if (i % 2 === 0) { ctx.fillStyle = 'rgba(29,27,46,.06)'; ctx.fillRect(L - 20, y, R - L + 40, hgt); }
    const mid = y + hgt / 2;
    ctx.fillStyle = INK; ctx.fillRect(L, y + 10, 92, hgt - 20);
    ctx.fillStyle = big ? YELLOW : PAPER; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${big ? Math.round(bigH / 2) : rowFont}px ${DISPLAY}`;
    ctx.fillText(String(row.rank), L + 46, mid + 3);
    ctx.fillStyle = row.player.color || RED; ctx.fillRect(L + 112, y + 14, 10, hgt - 28);
    ctx.fillStyle = INK; ctx.textAlign = 'left';
    ctx.font = `700 ${big ? Math.round(bigH * 0.48) : rowFont}px ${DISPLAY}`;
    ctx.fillText(ellipsis(ctx, row.player.name, 420), L + 142, mid + 3);
    ctx.textAlign = 'right';
    ctx.fillText(String(row.points), R, mid + 3);
    ctx.font = `600 ${rowH >= 72 ? 30 : 26}px ${BODY}`; ctx.fillStyle = 'rgba(29,27,46,.65)';
    ctx.fillText(i === 0 ? '—' : '+' + (first.points - row.points), R - 150, mid + 3);
    ctx.textBaseline = 'alphabetic';
    y += hgt + 6;
  });
  if (more) {
    ctx.textAlign = 'left'; ctx.font = `500 28px ${BODY}`; ctx.fillStyle = 'rgba(29,27,46,.6)';
    ctx.fillText(ellipsis(ctx, '+ ' + story.standings.slice(shown.length).map((r) => r.rank + '. ' + r.player.name + ' ' + r.points).join(' · '),
      R - L - 142), L + 142, y + 32);
    y += 46;
  }

  // Courses jouées : grille très compacte, numéro, circuit, vainqueur.
  if (races.length) {
    y += 44;
    ctx.textAlign = 'left'; ctx.font = `700 24px ${BODY}`; ctx.fillStyle = 'rgba(29,27,46,.6)';
    ctx.fillText(races.length + ' COURSES', L, y);
    ctx.textAlign = 'right'; ctx.fillText('VAINQUEUR', R, y);
    y += 14;
    const gap = cols === 4 ? 14 : 24;
    const cw = (R - L - gap * (cols - 1)) / cols;
    const byId = Object.fromEntries(players.map((p) => [p.id, p]));
    races.forEach((race, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const cx = L + c * (cw + gap), cy = y + r * courseRowH;
      const midY = cy + courseRowH / 2;
      const box = courseRowH - 14;
      ctx.fillStyle = INK; ctx.fillRect(cx, midY - box / 2, box, box);
      ctx.fillStyle = PAPER; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.round(box * 0.55)}px ${DISPLAY}`;
      ctx.fillText(String(race.num ?? i + 1), cx + box / 2, midY + 1);
      const winner = byId[raceWinners(race)[0]];
      const chipW = cols === 2 ? 52 : 40;
      if (winner) {
        ctx.fillStyle = winner.color || RED;
        roundRect(ctx, cx + cw - chipW, midY - box / 2, chipW, box, 6); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(box * 0.46)}px ${DISPLAY}`;
        ctx.fillText(winner.name.trim().slice(0, 2).toUpperCase(), cx + cw - chipW / 2, midY + 1);
      }
      ctx.fillStyle = INK; ctx.textAlign = 'left';
      ctx.font = `600 ${cols === 2 ? 26 : cols === 3 ? 22 : 19}px ${BODY}`;
      ctx.fillText(ellipsis(ctx, race.contentName || 'Course ' + (i + 1), cw - box - chipW - 26), cx + box + 12, midY + 1);
      ctx.textBaseline = 'alphabetic';
      if (r > 0 && c === 0) { ctx.fillStyle = 'rgba(29,27,46,.12)'; ctx.fillRect(L, cy, R - L, 2); }
    });
    y += Math.ceil(races.length / cols) * courseRowH;
  }

  // Faits marquants : une icône par type, un nom en gras, un détail court.
  y += 50;
  for (const f of facts) {
    if (y + 12 > limit) break;
    factBadge(ctx, f.key, L + 26, y - 12, 54);
    ctx.textAlign = 'left'; ctx.fillStyle = INK;
    ctx.font = `700 34px ${DISPLAY}`;
    const who = ellipsis(ctx, f.who || f.text, 360);
    ctx.fillText(who, L + 72, y);
    const wx = L + 72 + ctx.measureText(who).width + 16;
    ctx.font = `500 30px ${BODY}`; ctx.fillStyle = 'rgba(29,27,46,.72)';
    if (f.short) ctx.fillText(ellipsis(ctx, f.short, R - wx), wx, y);
    y += 62;
  }

  // Talon : défi + code-barres.
  perforation(ctx, X0, X1, footerY);
  ctx.textAlign = 'left'; ctx.fillStyle = INK;
  ctx.font = `700 50px ${DISPLAY}`;
  ctx.fillText('Qui relève', L, footerY + 92);
  ctx.fillText('le défi ?', L, footerY + 148);
  ctx.font = `500 24px ${BODY}`; ctx.fillStyle = 'rgba(29,27,46,.7)';
  ctx.fillText(ellipsis(ctx, appUrl().replace(/^https?:\/\//, '').replace(/\/$/, ''), 430), L, footerY + 192);
  let bx = R - 330;
  ctx.fillStyle = INK;
  while (bx < R) { const w = 2 + Math.floor(rnd() * 4) * 2; ctx.fillRect(bx, footerY + 58, w, 110); bx += w + 3 + Math.floor(rnd() * 3) * 3; }
  ctx.font = `500 20px ${BODY}`; ctx.textAlign = 'right';
  ctx.fillText('MKP-' + String(gp.id || '').slice(-6).toUpperCase(), R, footerY + 192);
  ctx.restore();
  return canvas;
}

const toBlob = (canvas) => new Promise((res) => canvas.toBlob(res, 'image/png'));

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* repli ci-dessous */ }
  const ta = h('textarea', { style: 'position:fixed;opacity:0' }, text);
  document.body.append(ta); ta.select();
  const ok = document.execCommand?.('copy');
  ta.remove();
  return !!ok;
}

// Fenêtre de partage : aperçu de la carte, message, actions.
export async function openShare({ session, gp, players }) {
  const story = gpStory(session, gp, players, { url: appUrl() });
  const canvas = await drawShareCard({ session, gp, players });
  const blob = await toBlob(canvas);
  const fileName = 'grand-prix-' + story.gpNumber + '.png';
  const file = new File([blob], fileName, { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  const canNative = !!navigator.canShare?.({ files: [file] });

  const actions = [
    { label: 'Copier le message', testid: 'button-copy-share', kind: 'btn-ghost',
      onClick: async () => toast(await copyText(story.message) ? 'Message copié' : 'Copie impossible', '') },
    { label: 'Télécharger', testid: 'button-download-card', kind: 'btn-ghost',
      onClick: () => { const a = h('a', { href: url, download: fileName }); document.body.append(a); a.click(); a.remove(); } },
  ];
  if (canNative) {
    actions.push({ label: 'Partager', testid: 'button-native-share', kind: 'btn-primary',
      onClick: async () => {
        // Certaines applis ignorent le texte joint à une image : on le copie aussi.
        await copyText(story.message);
        try { await navigator.share({ files: [file], text: story.message, title: story.title }); }
        catch (e) { if (e?.name !== 'AbortError') toast('Partage impossible', 'error'); }
      } });
  }

  modal({
    title: 'Partager le résultat',
    body: h('div', { class: 'share-box' },
      h('img', { class: 'share-preview', src: url, alt: 'Carte : ' + story.title, 'data-testid': 'share-card' }),
      h('p', { class: 'share-text', 'data-testid': 'share-message' }, story.message)),
    actions,
    onClose: () => setTimeout(() => URL.revokeObjectURL(url), 1000),
  });
}
