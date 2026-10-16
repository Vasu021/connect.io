import type { ReactNode } from 'react';

/**
 * The preset avatars, drawn rather than uploaded.
 *
 * Keeping them as a fixed set of SVGs means no uploads to moderate, nothing to
 * store, and faces that stay crisp from a 24px chip to a 96px profile picture.
 * The ids must match `server/src/lib/avatars.ts`.
 */
export type AvatarId =
  | 'cat'
  | 'dog'
  | 'fox'
  | 'giraffe'
  | 'panda'
  | 'bear'
  | 'bunny'
  | 'frog'
  | 'owl'
  | 'penguin'
  | 'koala'
  | 'tiger';

type Animal = {
  label: string;
  bg: string;
  draw: ReactNode;
};

const DARK = '#3a2f46';

/** A pair of eyes that blink on their own — the whole reason these feel alive. */
function Eyes({ cx = 32, y = 34, spread = 7, r = 3.1 }: { cx?: number; y?: number; spread?: number; r?: number }) {
  return (
    <>
      <circle className="av-eye" cx={cx - spread} cy={y} r={r} fill={DARK} />
      <circle className="av-eye" cx={cx + spread} cy={y} r={r} fill={DARK} />
      <circle cx={cx - spread + 1.1} cy={y - 1.1} r={r * 0.33} fill="#fff" opacity="0.92" />
      <circle cx={cx + spread + 1.1} cy={y - 1.1} r={r * 0.33} fill="#fff" opacity="0.92" />
    </>
  );
}

function Smile({ cx = 32, cy = 43, w = 5 }: { cx?: number; cy?: number; w?: number }) {
  return (
    <path
      d={`M${cx - w} ${cy} q${w} ${w * 0.8} ${w * 2} 0`}
      fill="none"
      stroke={DARK}
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  );
}

export const ANIMALS: Record<AvatarId, Animal> = {
  cat: {
    label: 'Cat',
    bg: '#ffd9a8',
    draw: (
      <>
        <path d="M16 26 L18 12 L30 20 Z" fill="#f6b172" />
        <path d="M48 26 L46 12 L34 20 Z" fill="#f6b172" />
        <path d="M19 24 L20 16 L27 21 Z" fill="#ffb7c5" />
        <path d="M45 24 L44 16 L37 21 Z" fill="#ffb7c5" />
        <circle cx="32" cy="36" r="19" fill="#ffc98a" />
        <Eyes y={34} spread={7.5} />
        <path d="M30 41 h4 l-2 2.4 Z" fill="#e8869b" />
        <Smile cy={44} w={4.5} />
        <g stroke={DARK} strokeWidth="1.1" strokeLinecap="round" opacity="0.55">
          <path d="M12 38 h7" />
          <path d="M12 43 h7" />
          <path d="M52 38 h-7" />
          <path d="M52 43 h-7" />
        </g>
      </>
    ),
  },

  dog: {
    label: 'Dog',
    bg: '#cbb6f7',
    draw: (
      <>
        <ellipse cx="14" cy="34" rx="7" ry="12" fill="#8d6b4f" />
        <ellipse cx="50" cy="34" rx="7" ry="12" fill="#8d6b4f" />
        <circle cx="32" cy="35" r="19" fill="#c08d64" />
        <ellipse cx="32" cy="43" rx="11" ry="8.5" fill="#f0d9bf" />
        <Eyes y={32} spread={7.5} />
        <ellipse cx="32" cy="39.5" rx="3.4" ry="2.6" fill={DARK} />
        <path d="M32 42 v3" stroke={DARK} strokeWidth="1.4" strokeLinecap="round" />
        <path d="M28 46 q4 3 8 0" fill="none" stroke={DARK} strokeWidth="1.5" strokeLinecap="round" />
      </>
    ),
  },

  fox: {
    label: 'Fox',
    bg: '#ffc2a0',
    draw: (
      <>
        <path d="M15 24 L17 10 L31 20 Z" fill="#e8743b" />
        <path d="M49 24 L47 10 L33 20 Z" fill="#e8743b" />
        <path d="M19 22 L20 15 L27 21 Z" fill="#fff0e6" />
        <path d="M45 22 L44 15 L37 21 Z" fill="#fff0e6" />
        <circle cx="32" cy="35" r="19" fill="#f4823f" />
        <path d="M32 29 q-14 4 -8 16 q8 6 16 0 q6 -12 -8 -16 Z" fill="#fff4ec" />
        <Eyes y={32} spread={8} />
        <path d="M30 41 h4 l-2 2.6 Z" fill={DARK} />
        <Smile cy={46} w={4} />
      </>
    ),
  },

  giraffe: {
    label: 'Giraffe',
    bg: '#ffe6a8',
    draw: (
      <>
        <path d="M24 16 v-6" stroke="#b9823c" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M40 16 v-6" stroke="#b9823c" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="24" cy="9" r="3" fill="#8f6027" />
        <circle cx="40" cy="9" r="3" fill="#8f6027" />
        <ellipse cx="32" cy="36" rx="17" ry="19" fill="#f2c15e" />
        <g fill="#c68a35" opacity="0.75">
          <circle cx="21" cy="28" r="3.4" />
          <circle cx="43" cy="27" r="3" />
          <circle cx="19" cy="40" r="2.8" />
          <circle cx="45" cy="39" r="3.2" />
        </g>
        <Eyes y={33} spread={7.5} />
        <ellipse cx="32" cy="45" rx="8" ry="6.5" fill="#f7dcae" />
        <circle cx="29.5" cy="44" r="1.3" fill={DARK} />
        <circle cx="34.5" cy="44" r="1.3" fill={DARK} />
      </>
    ),
  },

  panda: {
    label: 'Panda',
    bg: '#e8eef7',
    draw: (
      <>
        <circle cx="16" cy="22" r="8" fill="#39343f" />
        <circle cx="48" cy="22" r="8" fill="#39343f" />
        <circle cx="32" cy="36" r="19" fill="#fdfdfd" />
        <ellipse cx="24" cy="34" rx="6.2" ry="7.4" fill="#39343f" transform="rotate(-12 24 34)" />
        <ellipse cx="40" cy="34" rx="6.2" ry="7.4" fill="#39343f" transform="rotate(12 40 34)" />
        <circle className="av-eye" cx="24.5" cy="34" r="2.5" fill="#fff" />
        <circle className="av-eye" cx="39.5" cy="34" r="2.5" fill="#fff" />
        <ellipse cx="32" cy="43" rx="3.2" ry="2.4" fill="#39343f" />
        <Smile cy={47} w={4} />
      </>
    ),
  },

  bear: {
    label: 'Bear',
    bg: '#e0bb97',
    draw: (
      <>
        <circle cx="16" cy="22" r="8" fill="#9c6b45" />
        <circle cx="48" cy="22" r="8" fill="#9c6b45" />
        <circle cx="16" cy="22" r="4" fill="#d79d6e" />
        <circle cx="48" cy="22" r="4" fill="#d79d6e" />
        <circle cx="32" cy="36" r="19" fill="#b47c4f" />
        <ellipse cx="32" cy="42" rx="10" ry="8" fill="#e6c49e" />
        <Eyes y={32} spread={7.5} />
        <ellipse cx="32" cy="39" rx="3.2" ry="2.4" fill={DARK} />
        <Smile cy={45} w={4} />
      </>
    ),
  },

  bunny: {
    label: 'Bunny',
    bg: '#ffd6e8',
    draw: (
      <>
        <ellipse cx="24" cy="15" rx="5" ry="13" fill="#f3f0f6" />
        <ellipse cx="40" cy="15" rx="5" ry="13" fill="#f3f0f6" />
        <ellipse cx="24" cy="16" rx="2.4" ry="8.5" fill="#ffb7cf" />
        <ellipse cx="40" cy="16" rx="2.4" ry="8.5" fill="#ffb7cf" />
        <circle cx="32" cy="38" r="18" fill="#fbfafc" />
        <Eyes y={36} spread={7} />
        <path d="M30 43 h4 l-2 2.3 Z" fill="#f08cae" />
        <path d="M32 45 v2.5" stroke={DARK} strokeWidth="1.3" strokeLinecap="round" />
        <path d="M28.5 50 h7" stroke={DARK} strokeWidth="1.4" strokeLinecap="round" />
      </>
    ),
  },

  frog: {
    label: 'Frog',
    bg: '#bdf0c4',
    draw: (
      <>
        <circle cx="21" cy="22" r="9" fill="#7fc98a" />
        <circle cx="43" cy="22" r="9" fill="#7fc98a" />
        <circle className="av-eye" cx="21" cy="22" r="5" fill="#fff" />
        <circle className="av-eye" cx="43" cy="22" r="5" fill="#fff" />
        <circle cx="21.8" cy="22" r="2.6" fill={DARK} />
        <circle cx="43.8" cy="22" r="2.6" fill={DARK} />
        <ellipse cx="32" cy="41" rx="19" ry="15" fill="#6dbd79" />
        <path d="M21 42 q11 9 22 0" fill="none" stroke="#2f6b3a" strokeWidth="2" strokeLinecap="round" />
        <circle cx="24" cy="36" r="1.5" fill="#8fd79a" />
        <circle cx="41" cy="37" r="1.8" fill="#8fd79a" />
      </>
    ),
  },

  owl: {
    label: 'Owl',
    bg: '#d4c3a5',
    draw: (
      <>
        <path d="M17 22 L15 11 L26 17 Z" fill="#8a6f52" />
        <path d="M47 22 L49 11 L38 17 Z" fill="#8a6f52" />
        <circle cx="32" cy="36" r="19" fill="#a98a66" />
        <circle cx="24" cy="33" r="8.5" fill="#f3e6d2" />
        <circle cx="40" cy="33" r="8.5" fill="#f3e6d2" />
        <circle className="av-eye" cx="24" cy="33" r="4.4" fill={DARK} />
        <circle className="av-eye" cx="40" cy="33" r="4.4" fill={DARK} />
        <circle cx="25.4" cy="31.6" r="1.5" fill="#fff" opacity="0.9" />
        <circle cx="41.4" cy="31.6" r="1.5" fill="#fff" opacity="0.9" />
        <path d="M32 38 l4 4 l-4 4 l-4 -4 Z" fill="#f0a63e" />
        <path d="M22 48 q10 5 20 0" fill="none" stroke="#8a6f52" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
  },

  penguin: {
    label: 'Penguin',
    bg: '#bcd8f5',
    draw: (
      <>
        <circle cx="32" cy="36" r="19" fill="#3b4557" />
        <ellipse cx="32" cy="39" rx="12.5" ry="14" fill="#fbfcfe" />
        <Eyes y={32} spread={6.5} r={2.8} />
        <path d="M32 37 l5 4 l-5 4 l-5 -4 Z" fill="#f5a623" />
        <path d="M27 41 h10" stroke="#d98c12" strokeWidth="1" strokeLinecap="round" />
        <circle cx="19" cy="31" r="2.6" fill="#ffb3c7" opacity="0.6" />
        <circle cx="45" cy="31" r="2.6" fill="#ffb3c7" opacity="0.6" />
      </>
    ),
  },

  koala: {
    label: 'Koala',
    bg: '#d6dde6',
    draw: (
      <>
        <circle cx="14" cy="28" r="10" fill="#9aa7b5" />
        <circle cx="50" cy="28" r="10" fill="#9aa7b5" />
        <circle cx="14" cy="28" r="6" fill="#c3cedb" />
        <circle cx="50" cy="28" r="6" fill="#c3cedb" />
        <circle cx="32" cy="36" r="18" fill="#aab7c5" />
        <Eyes y={33} spread={7.5} r={2.9} />
        <ellipse cx="32" cy="42" rx="5" ry="6" fill="#4a4550" />
        <ellipse cx="30.4" cy="40.5" rx="1.4" ry="1.8" fill="#6d6676" opacity="0.8" />
        <Smile cy={50} w={3.6} />
      </>
    ),
  },

  tiger: {
    label: 'Tiger',
    bg: '#ffcf96',
    draw: (
      <>
        <circle cx="17" cy="21" r="7.5" fill="#e07f2c" />
        <circle cx="47" cy="21" r="7.5" fill="#e07f2c" />
        <circle cx="17" cy="21" r="3.6" fill="#ffd9b0" />
        <circle cx="47" cy="21" r="3.6" fill="#ffd9b0" />
        <circle cx="32" cy="36" r="19" fill="#f59b3c" />
        <g stroke="#6b3d12" strokeWidth="2" strokeLinecap="round" opacity="0.85">
          <path d="M26 20 l-2 6" />
          <path d="M32 18 v6" />
          <path d="M38 20 l2 6" />
          <path d="M15 36 h5" />
          <path d="M49 36 h-5" />
        </g>
        <ellipse cx="32" cy="42" rx="10" ry="7.5" fill="#fde3c4" />
        <Eyes y={32} spread={7.5} />
        <path d="M30 40 h4 l-2 2.4 Z" fill="#c1552f" />
        <Smile cy={45} w={4} />
      </>
    ),
  },
};

export const AVATAR_IDS = Object.keys(ANIMALS) as AvatarId[];

export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === 'string' && value in ANIMALS;
}

export function avatarLabel(id: AvatarId): string {
  return ANIMALS[id].label;
}

/** Just the face — the caller supplies the frame. */
export function AnimalFace({ id }: { id: AvatarId }) {
  const animal = ANIMALS[id];
  return (
    <svg viewBox="0 0 64 64" className="animal-face" role="img" aria-label={animal.label}>
      <circle cx="32" cy="32" r="32" fill={animal.bg} />
      {animal.draw}
    </svg>
  );
}
