// ============================================================
// Partage du résultat d'un GP : carte image au format story (1080×1920)
// et message prêt à coller dans un groupe.
// ============================================================

import { h, modal, toast } from './ui.js';
import { gpStory, gpHighlights } from './engine.js';

const W = 1080;
const H = 1920;
const TIERS = { 1: ['#ffd34d', '#c98f00'], 2: ['#cfd6e0', '#7d8796'], 3: ['#e8a06a', '#9c5428'] };
const DISPLAY = 'Chillax, "General Sans", sans-serif';
const BODY = '"General Sans", system-ui, sans-serif';

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

function checker(ctx, y, size = 30) {
  for (let x = 0; x < W; x += size) {
    for (let row = 0; row < 2; row++) {
      ctx.fillStyle = ((x / size + row) % 2) ? '#f6f1e7' : '#16131d';
      ctx.fillRect(x, y + row * size, size, size);
    }
  }
}

function avatar(ctx, player, cx, cy, r, ring) {
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r + 14, 0, Math.PI * 2); ctx.fillStyle = ring; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, r + 6, 0, Math.PI * 2); ctx.fillStyle = '#1b1724'; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = player.color || '#ff5a49'; ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(r * 0.8)}px ${DISPLAY}`;
  ctx.fillText(player.name.trim().slice(0, 2).toUpperCase(), cx, cy + 2);
  ctx.restore();
}

// Dessine la carte et renvoie le canvas.
export async function drawShareCard({ session, gp, players }) {
  await fontsReady();
  const story = gpStory(session, gp, players);
  const facts = gpHighlights(gp, players);
  const last = story.standings.at(-1);
  if (story.standings.length >= 3 && last.rank > 1 && story.standings.filter((r) => r.rank === last.rank).length === 1) {
    facts.push({ key: 'last', title: 'Lanterne rouge', text: last.player.name + ' · ' + last.points + ' pts' });
  }
  const order = ['wins', 'last', 'comeback', 'tight'];
  facts.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Fond : nuit violette, halo doré derrière le podium, rayons discrets.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#2a1230'); bg.addColorStop(0.45, '#1a1524'); bg.addColorStop(1, '#100e16');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, 860);
  for (let i = 0; i < 18; i++) {
    ctx.rotate((Math.PI * 2) / 18);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-60, -1100); ctx.lineTo(60, -1100); ctx.closePath();
    ctx.fillStyle = 'rgba(255, 197, 61, 0.035)'; ctx.fill();
  }
  ctx.restore();
  const glow = ctx.createRadialGradient(W / 2, 900, 40, W / 2, 900, 620);
  glow.addColorStop(0, 'rgba(255, 197, 61, 0.30)'); glow.addColorStop(1, 'rgba(255, 197, 61, 0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  checker(ctx, 0); checker(ctx, H - 60);

  // En-tête.
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(255,255,255,.62)';
  ctx.font = `600 34px ${BODY}`;
  ctx.fillText(ellipsis(ctx, ('Grand Prix ' + story.gpNumber + '  ·  ' + session.name).toUpperCase(), 900), W / 2, 210);

  ctx.font = `700 40px ${DISPLAY}`;
  const kw = ctx.measureText(story.kicker.toUpperCase()).width + 70;
  ctx.fillStyle = '#ff5a49';
  roundRect(ctx, (W - kw) / 2, 248, kw, 70, 35); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(story.kicker.toUpperCase(), W / 2, 297);

  const leaders = story.standings.filter((r) => r.rank === 1);
  const winnerText = leaders.map((r) => r.player.name).join(' & ') || '—';
  fitFont(ctx, winnerText, 700, 140, DISPLAY, 960);
  ctx.fillStyle = '#ffd34d';
  ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowOffsetY = 6; ctx.shadowBlur = 0;
  ctx.fillText(winnerText, W / 2, 465);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.font = `500 42px ${BODY}`;
  const first = story.standings[0];
  ctx.fillText(leaders.length > 1 ? 'à égalité, ' + first.points + ' pts chacun' : 'remporte le GP avec ' + (first?.points ?? 0) + ' pts', W / 2, 535);

  // Podium.
  const base = 1220;
  const cols = [
    { idx: 1, x: 250, hgt: 210, r: 62 },
    { idx: 0, x: 540, hgt: 300, r: 80 },
    { idx: 2, x: 830, hgt: 150, r: 56 },
  ];
  for (const c of cols) {
    const row = story.standings[c.idx];
    if (!row) continue;
    const tier = TIERS[Math.min(row.rank, 3)];
    const top = base - c.hgt;
    const g = ctx.createLinearGradient(0, top, 0, base);
    g.addColorStop(0, tier[0]); g.addColorStop(1, tier[1]);
    ctx.fillStyle = g;
    roundRect(ctx, c.x - 130, top, 260, c.hgt, [22, 22, 0, 0]); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(c.x - 118, top + 6, 236, 6);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.font = `700 ${c.idx === 0 ? 120 : 96}px ${DISPLAY}`;
    ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowOffsetY = 5;
    ctx.fillText(String(row.rank), c.x, top + (c.idx === 0 ? 130 : 108));
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = `600 34px ${BODY}`;
    ctx.fillText(row.points + ' pts', c.x, top - 22);
    ctx.fillStyle = '#fff'; ctx.font = `700 46px ${DISPLAY}`;
    ctx.fillText(ellipsis(ctx, row.player.name, 270), c.x, top - 70);
    avatar(ctx, row.player, c.x, top - 120 - c.r - 14, c.r, tier[0]);
  }
  ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(90, base, W - 180, 6);

  // Suite du classement.
  let y = base + 70;
  const rest = story.standings.slice(3);
  rest.slice(0, 3).forEach((row) => {
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = `700 36px ${DISPLAY}`;
    ctx.fillText(String(row.rank), 150, y);
    ctx.fillStyle = '#fff'; ctx.font = `600 38px ${BODY}`;
    ctx.fillText(ellipsis(ctx, row.player.name, 560), 220, y);
    ctx.textAlign = 'right'; ctx.font = `700 36px ${DISPLAY}`;
    ctx.fillText(row.points + ' pts', W - 150, y);
    y += 58;
  });
  if (rest.length > 3) {
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = `500 32px ${BODY}`;
    ctx.fillText('+ ' + (rest.length - 3) + ' autre' + (rest.length > 4 ? 's' : ''), W / 2, y);
    y += 50;
  }

  // Faits marquants, tant qu'il reste de la place au-dessus du pied de carte.
  y = Math.max(y, base + 50) - 6;
  const colors = { wins: '#ffc53d', comeback: '#3ecf6f', tight: '#23b8d1', last: '#ff5a49' };
  for (const f of facts) {
    if (y + 108 > 1755) break;
    ctx.fillStyle = 'rgba(255,255,255,.07)';
    roundRect(ctx, 90, y, W - 180, 108, 22); ctx.fill();
    ctx.fillStyle = colors[f.key] || '#ffc53d';
    roundRect(ctx, 90, y, 12, 108, [22, 0, 0, 22]); ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillStyle = colors[f.key] || '#ffc53d'; ctx.font = `700 26px ${BODY}`;
    ctx.fillText(f.title.toUpperCase(), 135, y + 42);
    ctx.fillStyle = '#fff'; ctx.font = `600 36px ${BODY}`;
    ctx.fillText(ellipsis(ctx, f.text, W - 290), 135, y + 86);
    y += 122;
  }

  // Pied de carte.
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff'; ctx.font = `700 44px ${DISPLAY}`;
  ctx.fillText('Qui relève le défi ?', W / 2, 1805);
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = `500 30px ${BODY}`;
  ctx.fillText(ellipsis(ctx, 'Mario Kart Party  ·  ' + appUrl().replace(/^https?:\/\//, '').replace(/\/$/, ''), 920), W / 2, 1848);
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
        try { await navigator.share({ files: [file], text: story.message, title: 'Grand Prix ' + story.gpNumber }); }
        catch (e) { if (e?.name !== 'AbortError') toast('Partage impossible', 'error'); }
      } });
  }

  modal({
    title: 'Partager le résultat',
    body: h('div', { class: 'share-box' },
      h('img', { class: 'share-preview', src: url, alt: 'Carte du Grand Prix ' + story.gpNumber, 'data-testid': 'share-card' }),
      h('p', { class: 'share-text', 'data-testid': 'share-message' }, story.message)),
    actions,
    onClose: () => setTimeout(() => URL.revokeObjectURL(url), 1000),
  });
}
