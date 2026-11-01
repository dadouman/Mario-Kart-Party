import { flushSave } from './store.js';
import { toast } from './ui.js';

export const APP_VERSION = '2026.11.01.3';

export function initUpdates() {
  document.documentElement.dataset.appVersion = APP_VERSION;
  try {
    if (!('serviceWorker' in navigator) || window.top !== window.self ||
        !['https:', 'http:'].includes(location.protocol) || !window.isSecureContext) return;

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      // Une saisie peut encore être dans la fenêtre de sauvegarde différée.
      if (!flushSave()) {
        toast('Nouvelle version prête. Exportez vos données avant de recharger : la sauvegarde locale est indisponible.', 'err');
        return;
      }
      reloading = true;
      location.reload();
    });

    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((registration) => {
      // Une PWA laissée ouverte doit également découvrir les nouvelles versions.
      window.addEventListener('focus', () => registration.update().catch(() => {}));
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update().catch(() => {});
      });
    }).catch((error) => console.warn('Mise à jour hors ligne indisponible', error));
  } catch (error) { /* Aperçu intégré : pas de service worker. */ }
}
