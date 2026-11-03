import { flushSave, exportJSON } from './store.js';
import { toast, modal, h, download } from './ui.js';

export const APP_VERSION = '2026.11.04.1';

export function initUpdates() {
  document.documentElement.dataset.appVersion = APP_VERSION;
  window.addEventListener('mkp-storage-conflict', () => {
    modal({
      title: 'Une sauvegarde plus récente existe',
      body: h('p', { class: 'sub' }, 'Un autre onglet a modifié les données. Rien n’a été écrasé : exporte les saisies de cet onglet si tu souhaites les conserver, puis recharge la sauvegarde récente.'),
      actions: [
        { label: 'Exporter cet onglet', kind: 'btn-outline',
          onClick: () => download('mario-kart-party-brouillon.json', exportJSON(), 'application/json') },
        { label: 'Recharger la sauvegarde récente', kind: 'btn-primary',
          onClick: () => location.reload() },
      ],
    });
  });
  try {
    if (!('serviceWorker' in navigator) || window.top !== window.self ||
        !['https:', 'http:'].includes(location.protocol) || !window.isSecureContext) return;

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      // Une saisie peut encore être dans la fenêtre de sauvegarde différée.
      if (!flushSave()) {
        toast('Mise à jour prête. Conservez les saisies par un export avant de recharger : sauvegarde locale indisponible ou modifiée dans un autre onglet.', 'err');
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
