import { env } from '../env.js';

export const ROUND_DURATION_MS = env.ROUND_DURATION_MS;
/** Pause after a reveal so players can read both words before the next round. */
export const REVEAL_PAUSE_MS = env.REVEAL_PAUSE_MS;
/** How long a dropped player has to come back before the game is abandoned. */
export const RECONNECT_GRACE_MS = env.RECONNECT_GRACE_MS;
/** Safety valve: a pair that cannot converge in this many rounds ends unmatched. */
export const MAX_ROUNDS = env.MAX_ROUNDS;
/**
 * How long a player must be gone before their partner is told. Brief drops —
 * a wifi blip, a page remount — resolve themselves inside this window, and
 * announcing them would just produce flickering "dropped / back" noise.
 */
export const PRESENCE_ANNOUNCE_DELAY_MS = env.PRESENCE_ANNOUNCE_DELAY_MS;
/** WAITING invites older than this are swept away. */
export const INVITE_TTL_MS = env.INVITE_TTL_MS;
