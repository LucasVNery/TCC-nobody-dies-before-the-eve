// src/combat/eliteDefs.ts
// Elite monster tuning (combat v2). Task 3 completes this file.

/** Telegraph (wind-up) duration per elite attack, in ms. Logged in session.start windows_ms. */
export const ELITE_TELEGRAPH_MS = { swing: 450, combo: 320, lunge: 500, slam: 700 } as const;
