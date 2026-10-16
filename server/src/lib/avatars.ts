/**
 * The preset avatars a player can choose from.
 *
 * Deliberately a fixed list rather than uploads: no moderation problem, no
 * storage, no way to put something unpleasant next to your name, and every
 * avatar is drawn as SVG on the client so it stays crisp at any size.
 *
 * The client has a matching renderer per id — adding one here needs a drawing
 * there, or it falls back to initials.
 */
export const AVATAR_IDS = [
  'cat',
  'dog',
  'fox',
  'giraffe',
  'panda',
  'bear',
  'bunny',
  'frog',
  'owl',
  'penguin',
  'koala',
  'tiger',
] as const;

export type AvatarId = (typeof AVATAR_IDS)[number];

const LOOKUP = new Set<string>(AVATAR_IDS);

export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === 'string' && LOOKUP.has(value);
}
