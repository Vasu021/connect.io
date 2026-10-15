import { env } from '../env.js';

export const ROUND_DURATION_MS = env.ROUND_DURATION_MS;
/** Pause after a reveal so players can read both words before the next round. */
export const REVEAL_PAUSE_MS = env.REVEAL_PAUSE_MS;
/** How long a dropped player has to come back before the game is abandoned. */
export const RECONNECT_GRACE_MS = env.RECONNECT_GRACE_MS;
/** Safety valve: a circle that cannot close in this many rounds ends unmatched. */
export const MAX_ROUNDS = env.MAX_ROUNDS;
/** How long after the host starts before play begins without the stragglers. */
export const START_GRACE_MS = env.START_GRACE_MS;
/** Consecutive missed rounds before a player is removed from the circle. */
export const MAX_MISSED_ROUNDS = env.MAX_MISSED_ROUNDS;
/** A room holds between these many players. */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

/**
 * Bounds the host can set a round to. Short enough to stay tense, long enough
 * that a big group can actually read what everyone said last round.
 */
export const MIN_ROUND_DURATION_MS = 5_000;
export const MAX_ROUND_DURATION_MS = 120_000;
/**
 * How long a player must be gone before their partner is told. Brief drops —
 * a wifi blip, a page remount — resolve themselves inside this window, and
 * announcing them would just produce flickering "dropped / back" noise.
 */
export const PRESENCE_ANNOUNCE_DELAY_MS = env.PRESENCE_ANNOUNCE_DELAY_MS;
/** WAITING invites older than this are swept away. */
export const INVITE_TTL_MS = env.INVITE_TTL_MS;
