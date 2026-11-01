// ============================================================
// Routeur + démarrage de l'application.
// ============================================================

import { render } from './ui.js';
import { HomeView, NewSessionView, SessionView, GpView, RaceView, NotFound } from './views.js';
import { TirageView, JeuxView, GameView, ClassementView, ReglagesView } from './views-admin.js';
import { getState } from './store.js';

function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const parts = hash.split('/').filter(Boolean);

  let view;
  try {
    if (parts.length === 0) view = HomeView();
    else if (parts[0] === 'nouvelle-session') view = NewSessionView();
    else if (parts[0] === 'session' && parts[1] && !parts[2]) view = SessionView(parts[1]);
    else if (parts[0] === 'session' && parts[1] && parts[2] === 'gp' && parts[3] && !parts[4])
      view = GpView(parts[1], parts[3]);
    else if (parts[0] === 'session' && parts[1] && parts[2] === 'gp' && parts[3] && parts[4] === 'course' && parts[5])
      view = RaceView(parts[1], parts[3], parseInt(parts[5], 10));
    else if (parts[0] === 'tirage') view = TirageView();
    else if (parts[0] === 'jeux' && !parts[1]) view = JeuxView();
    else if (parts[0] === 'jeux' && parts[1]) view = GameView(parts[1]);
    else if (parts[0] === 'classement') view = ClassementView();
    else if (parts[0] === 'reglages') view = ReglagesView();
    else view = NotFound();
  } catch (e) {
    console.error(e);
    view = NotFound();
  }
  render(view);

  // Onglet actif dans la barre de navigation
  const tab = parts[0] || 'home';
  document.querySelectorAll('.tabbar-link').forEach((a) => {
    a.classList.toggle('active', a.dataset.tab === tab || (tab.startsWith('session') && a.dataset.tab === 'home'));
  });

  // Titre de page
  const st = getState();
  document.title = st.settings.appName;
}

window.addEventListener('hashchange', route);
route();

// ---------- Thème ----------

(function () {
  const t = document.querySelector('[data-theme-toggle]');
  const r = document.documentElement;
  function current() {
    return r.getAttribute('data-theme') ||
      (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  }
  function apply(mode) {
    r.setAttribute('data-theme', mode);
    try { localStorage.setItem('mkp-theme', mode); } catch (e) { /* aperçu */ }
    t.setAttribute('aria-label', mode === 'dark' ? 'Passer en thème jour' : 'Passer en thème nuit');
  }
  apply(current());
  t.addEventListener('click', () => apply(current() === 'dark' ? 'light' : 'dark'));
})();

// ---------- Service worker (hors aperçu en iframe) ----------

try {
  if ('serviceWorker' in navigator && window.top === window.self && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
} catch (e) { /* ignore */ }
