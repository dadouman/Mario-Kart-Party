// ============================================================
// Petits utilitaires d'interface : création DOM, toasts, modales.
// ============================================================

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (typeof v === 'boolean') { el[k] = v; continue; }
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2), v);
    } else if (k === 'class') {
      el.className = v;
    } else if (k === 'html') {
      el.innerHTML = v; // jamais de contenu utilisateur non échappé à l'appel
    } else if (k === 'dataset') {
      Object.assign(el.dataset, v);
    } else {
      el.setAttribute(k, v);
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function render(view) {
  const main = document.getElementById('main');
  clear(main).append(view);
  main.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

// ---------- Toasts ----------

export function toast(msg, kind = '') {
  const root = document.getElementById('toast-root');
  const t = h('div', { class: 'toast' + (kind ? ' toast-' + kind : ''), role: 'status' }, msg);
  root.append(t);
  setTimeout(() => t.remove(), 2600);
}

// ---------- Modales ----------

let activeModalClose = null;

export function modal({ title, body, actions = [], onClose }) {
  activeModalClose?.();
  const root = document.getElementById('modal-root');
  const opener = document.activeElement;
  const previousOverflow = document.body.style.overflow;
  const background = [...document.body.children].filter(el =>
    el !== root && el.tagName !== 'SCRIPT' && el.id !== 'toast-root');
  const wasInert = background.map(el => el.inert);
  background.forEach(el => { el.inert = true; });
  document.body.style.overflow = 'hidden';
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', esc);
    window.removeEventListener('hashchange', close);
    background.forEach((el, i) => { el.inert = wasInert[i]; });
    document.body.style.overflow = previousOverflow;
    if (activeModalClose === close) activeModalClose = null;
    if (onClose) onClose();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  };
  const esc = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key !== 'Tab') return;
    const focusable = [...box.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')]
      .filter(el => el.getClientRects().length > 0 && !el.closest('[hidden]'));
    const first = focusable[0], last = focusable.at(-1);
    if (!first) { e.preventDefault(); box.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', esc);
  window.addEventListener('hashchange', close);

  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
    h('header', { class: 'modal-heading' },
      h('h2', { class: 'section-title' }, title),
      h('button', { class: 'icon-btn', 'aria-label': 'Fermer la fenêtre', onclick: close }, '×')),
    h('div', { class: 'modal-body' }, body),
    actions.length
      ? h('footer', { class: 'row modal-actions' },
          ...actions.map((a) =>
            h('button', {
              class: 'btn ' + (a.kind || 'btn-ghost'),
              'data-testid': a.testid,
              onclick: () => { if (a.onClick) a.onClick(close); else close(); },
            }, a.label)
          )
        )
      : null
  );
  const backdrop = h('div', { class: 'modal-backdrop' }, box);
  root.append(backdrop);
  activeModalClose = close;
  box.querySelector('input:not([type="checkbox"]), textarea, select')?.focus({ preventScroll: true });
  if (!box.contains(document.activeElement)) box.querySelector('button')?.focus({ preventScroll: true });
  return close;
}

export function confirmModal({ title, message, confirmLabel = 'Confirmer', danger = false, onConfirm }) {
  modal({
    title,
    body: h('p', { class: 'sub' }, message),
    actions: [
      { label: 'Annuler' },
      { label: confirmLabel, kind: danger ? 'btn-danger' : 'btn-primary', onClick: (close) => { close(); onConfirm(); } },
    ],
  });
}

// ---------- Divers ----------

export const fmtDate = (ts) =>
  new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

export const fmtDateTime = (ts) =>
  new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) +
  ' · ' +
  new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type: type + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function readFile(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsText(file);
  });
}

export const PLAYER_COLORS = [
  '#e63946', '#2a9d8f', '#457b9d', '#e9c46a', '#9b5de5',
  '#f4845f', '#00b4d8', '#ef476f', '#8ac926', '#ff9f1c',
  '#6a4c93', '#38b000',
];

export function avatarEl(player, size = 26) {
  const initials = player.name.trim().slice(0, 2).toUpperCase();
  return h('span', {
    class: 'player-avatar',
    style: `background:${player.color};width:${size}px;height:${size}px;font-size:${Math.round(size * .38)}px`,
    'aria-hidden': 'true',
  }, initials);
}
