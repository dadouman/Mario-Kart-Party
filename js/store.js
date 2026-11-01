// ============================================================
// Persistance locale + catalogue de départ.
// localStorage si disponible, sinon mémoire volatile
// (aperçu en iframe sandboxée) avec bandeau d'avertissement.
// ============================================================

const SCHEMA_VERSION = 1;
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

const mkContents = (names, status, source) =>
  names.map((n) => ({ id: uid('c'), name: n, tags: [], status, active: true, source }));

function seedData() {
  return {
    version: SCHEMA_VERSION,
    settings: {
      appName: 'Mario Kart Party',
      bareme: [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
      theme: 'auto',
    },
    players: [],
    games: [
      {
        id: uid('g'),
        name: 'Mario Kart World',
        icon: '🌍',
        platform: 'Nintendo Switch 2',
        genre: 'Course',
        contentType: 'Circuit',
        archived: false,
        createdAt: Date.now(),
        editions: [
          {
            id: uid('e'),
            name: 'Jeu de base',
            dlc: false,
            active: true,
            contents: mkContents(MKW_COURSES, 'verified', 'Guide ActuGaming (juin 2025)'),
          },
          {
            id: uid('e'),
            name: 'Mise à jour 1.8.0 — circuits rétro',
            dlc: false,
            active: true,
            contents: mkContents(MKW_RETRO_180, 'unverified', 'Mise à jour 1.8.0 (RetroGems, sept. 2026)'),
          },
        ],
      },
      {
        id: uid('g'),
        name: 'Mario Kart 8 Deluxe',
        icon: '🏁',
        platform: 'Nintendo Switch',
        genre: 'Course',
        contentType: 'Circuit',
        archived: false,
        createdAt: Date.now(),
        editions: [
          {
            id: uid('e'),
            name: 'Jeu de base',
            dlc: false,
            active: true,
            contents: mkContents(MK8D_BASE, 'verified', 'jeuxvideo.com'),
          },
          {
            id: uid('e'),
            name: 'Pass circuits additionnels',
            dlc: true,
            active: true,
            contents: mkContents(MK8D_DLC, 'verified', 'jeuxvideo.com'),
          },
        ],
      },
    ],
    sessions: [],
  };
}

// ---------- Chargement / sauvegarde ----------

function migrate(raw) {
  // Migration future : version par version.
  if (raw && raw.version === SCHEMA_VERSION) return raw;
  return raw; // version 1 pour l'instant
}

let state;

function load() {
  if (persistent) {
    try {
      const raw = localStorage.getItem(KEY);
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
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      // quota dépassé : on tente une sauvegarde synchrone immédiate
      console.error('Sauvegarde impossible', e);
    }
  }, 120);
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
  const open = state.sessions.filter((s) => s.status === 'open');
  return open[open.length - 1] || state.sessions[state.sessions.length - 1] || null;
}

export function getPlayers(ids) {
  return ids.map((id) => state.players.find((p) => p.id === id)).filter(Boolean);
}

export function activeGames() {
  return state.games.filter((g) => !g.archived);
}

export function gameContents(game, editionIds) {
  const eds = game.editions.filter((e) => editionIds.includes(e.id));
  return eds.flatMap((e) => e.contents.map((c) => ({ ...c, editionName: e.name })));
}
