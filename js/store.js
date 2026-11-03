// ============================================================
// Persistance locale + catalogue de départ.
// localStorage si disponible, sinon mémoire volatile
// (aperçu en iframe sandboxée) avec bandeau d'avertissement.
// ============================================================

const SCHEMA_VERSION = 2;
const KEY = 'mkp-data';

let persistent = true;
try {
  window.localStorage.setItem('__mkp-test', '1');
  window.localStorage.removeItem('__mkp-test');
} catch (e) {
  persistent = false;
}

export const isPersistent = () => persistent;

const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

// ---------- Catalogue de départ ----------
// Noms français officiels. Sources :
// - Mario Kart World (lancement) : guide ActuGaming, juin 2025
// - Mario Kart World 1.8.0 (10 circuits rétro) : RetroGems, sept. 2026 — statut « à vérifier »
// - Mario Kart 8 Deluxe (jeu de base + Pass circuits) : jeuxvideo.com

const MKW_COURSES = [
  // Coupe Champignon
  'Circuit Mario Bros.', 'Trophéopolis', 'Mont Tchou Tchou', 'Spatioport DK',
  // Coupe Fleur
  'Désert du soleil', 'Souk Maskass', 'Stade Wario', 'Bateau volant',
  // Coupe Étoile
  'Alpes DK', 'Pic de l\u2019observatoire', 'Cité Sorbet', 'Galion de Wario',
  // Coupe Carapace
  'Plage Koopa', 'Savane sauvage', 'Trophéopolis 2', 'Stade Peach',
  // Coupe Banane
  'Plage Peach', 'Cité Fleur-de-sel', 'Jungle Dino Dino', 'Bloc ? antique',
  // Coupe Feuille
  'Chutes Cheep Cheep', 'Gouffre Pissenlit', 'Cinéma Boo', 'Fournaise ossesseuse',
  // Coupe Éclair
  'Prairie Meuh Meuh', 'Montagne Choco', 'Usine Toad', 'Château de Bowser',
  // Coupe spéciale
  'Chemin du chêne', 'Circuit Mario', 'Stade Peach 2', 'Route Arc-en-ciel',
];

const MKW_RETRO_180 = [
  'Circuit Mario 1', 'Circuit Mario 2', 'Circuit Mario 3',
  'Vallée Fantôme 1', 'Vallée Fantôme 2', 'Vallée Fantôme 3',
  'Île Choco 1', 'Île Choco 2', 'Plage Koopa 2', 'Lac Vanille 1',
];

const MK8D_BASE = [
  // Nitro
  'Champidrome', 'Parc Glougloop', 'Piste aux délices', 'Temple Thwomp',
  'Circuit Mario', 'Promenade Toad', 'Manoir Trempé', 'Cascades Maskass',
  'Aéroport Azur', 'Lagon Tourbillon', 'Club Mario', 'Descente givrée',
  'Voie céleste', 'Désert Toussec', 'Château de Bowser', 'Route Arc-en-ciel',
  // Rétro (jeu de base)
  'Wii Prairie Meuh Meuh', 'GBA Circuit Mario', 'DS Plage Cheep Cheep', 'N64 Autoroute Toad',
  'GCN Désert Sec Sec', 'SNES Plaine Donut 3', 'N64 Autodrome royal', '3DS Forêt tropicale DK',
  'DS Stade Wario', 'GCN Royaume Sorbet', '3DS Piste musicale', 'N64 Vallée Yoshi',
  'DS Horloge Tic-Tac', '3DS Égout Piranha', 'Wii Volcan grondant', 'N64 Route Arc-en-ciel',
];

const MK8D_DLC = [
  'GCN Circuit Yoshi', 'Arène d\u2019Excitebike', 'Route du dragon', 'Mute City',
  'GCN Parc Baby', 'GBA Pays Fromage', 'Passage Feuillage', 'Animal Crossing',
  'Wii Mine Wario', 'SNES Route Arc-en-ciel', 'Station Glagla', 'Circuit d\u2019Hyrule',
  '3DS Koopapolis', 'GBA Route Ruban', 'Métro Turbo', 'Big Blue',
];

const mkContents = (names) => names.map((n) => ({ id: uid('c'), name: n, active: true }));

function seedData() {
  return {
    version: SCHEMA_VERSION,
    settings: {
      appName: 'Mario Kart Party',
      bareme: [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      theme: 'auto',
    },
    players: [],
    games: [
      {
        id: uid('g'),
        name: 'Mario Kart World',
        icon: '🌍',
        racers: 24,
        archived: false,
        createdAt: Date.now(),
        editions: [
          {
            id: uid('e'),
            name: 'Jeu de base',
            dlc: false,
            active: true,
            contents: mkContents(MKW_COURSES),
          },
          {
            id: uid('e'),
            name: 'Mise à jour 1.8.0 — circuits rétro',
            dlc: false,
            active: true,
            contents: mkContents(MKW_RETRO_180),
          },
        ],
      },
      {
        id: uid('g'),
        name: 'Mario Kart 8 Deluxe',
        icon: '🏁',
        racers: 12,
        archived: false,
        createdAt: Date.now(),
        editions: [
          {
            id: uid('e'),
            name: 'Jeu de base',
            dlc: false,
            active: true,
            contents: mkContents(MK8D_BASE),
          },
          {
            id: uid('e'),
            name: 'Pass circuits additionnels',
            dlc: true,
            active: true,
            contents: mkContents(MK8D_DLC),
          },
        ],
      },
    ],
    sessions: [],
  };
}

// ---------- Chargement / sauvegarde ----------

// v1 -> v2 : modèle essentiel. Plus de statut de vérification, de source,
// de plateforme/genre, de statut de session ni d'historique de tirages.
// Les GP validés gardent leurs résultats ; les points sont recalculés en direct.
function migrateV1(data) {
  for (const game of data.games || []) {
    delete game.platform; delete game.genre; delete game.contentType;
    for (const ed of game.editions || []) {
      for (const c of ed.contents || []) {
        if (c.status === 'archived') { c.archived = true; c.active = false; }
        delete c.status; delete c.source; delete c.tags;
      }
    }
  }
  for (const session of data.sessions || []) {
    delete session.status; delete session.draws;
    for (const gp of session.grandPrix || []) {
      delete gp.validated; delete gp.validatedAt; delete gp.points; delete gp.history;
    }
  }
  delete data.draws;
  if (data.settings?.drawPreferences) {
    delete data.settings.drawPreferences.unique;
    delete data.settings.drawPreferences.excludeRecent;
  }
  data.version = 2;
  return data;
}

export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  if (!raw.version || raw.version < 2) raw = migrateV1(raw);
  return raw;
}

let state;
let lastPersisted = null;
let dirty = false;
let conflictNotified = false;

function load() {
  if (persistent) {
    try {
      const raw = localStorage.getItem(KEY);
      lastPersisted = raw;
      if (raw) {
        state = migrate(JSON.parse(raw));
        return;
      }
    } catch (e) { /* données corrompues : on repart du catalogue */ }
  }
  state = seedData();
  save();
}

let saveTimer = null;
export function save() {
  if (!persistent) return;
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 120);
}

export function flushSave() {
  clearTimeout(saveTimer);
  if (!persistent || !dirty) return true;
  try {
    const current = localStorage.getItem(KEY);
    if (current !== lastPersisted) {
      if (!conflictNotified) {
        conflictNotified = true;
        window.dispatchEvent(new CustomEvent('mkp-storage-conflict'));
      }
      return false;
    }
    const next = JSON.stringify(state);
    if (current && current !== next) {
      try { localStorage.setItem('mkp-backup-previous', current); }
      catch (error) { console.warn('Copie précédente indisponible', error); }
    }
    localStorage.setItem(KEY, next);
    lastPersisted = next;
    dirty = false;
    return true;
  } catch (e) {
    console.error('Sauvegarde impossible', e);
    return false;
  }
}

load();

export function getState() {
  return state;
}

export function resetAll() {
  state = seedData();
  save();
}

// ---------- Export / import ----------

export function exportJSON() {
  return JSON.stringify(state, null, 2);
}

export function previousBackup() {
  try { return persistent ? localStorage.getItem('mkp-backup-previous') : null; }
  catch (error) { return null; }
}

export function importJSON(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !data.version || !Array.isArray(data.games) || !Array.isArray(data.sessions)) {
    throw new Error('Format de sauvegarde invalide');
  }
  if (data.version > SCHEMA_VERSION) {
    throw new Error('Sauvegarde trop récente pour cette version de l\u2019application');
  }
  state = migrate(data);
  save();
}

// ---------- Accès métier ----------

export const newId = uid;

export function findGame(id) {
  return state.games.find((g) => g.id === id);
}

export function findSession(id) {
  return state.sessions.find((s) => s.id === id);
}

export function lastSession() {
  return state.sessions[state.sessions.length - 1] || null;
}

export function getPlayers(ids) {
  return ids.map((id) => state.players.find((p) => p.id === id)).filter(Boolean);
}

export function activeGames() {
  return state.games.filter((g) => !g.archived);
}

export function gameContents(game, editionIds) {
  const eds = game.editions.filter((e) => editionIds.includes(e.id));
  return eds.flatMap((e) => e.contents.map((c) => ({
    ...c, editionName: e.name,
    gameId: game.id, gameName: game.name, gameIcon: game.icon,
  })));
}
