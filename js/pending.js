// ============================================================
// Passation d'un tirage entre vues (ex. Tirage rapide -> Nouvelle session).
// ============================================================

let pendingItems = null;

export const setPendingDraw = (items) => { pendingItems = items; };
export const clearPendingDraw = () => { pendingItems = null; };
export const getPendingDraw = () => pendingItems;
