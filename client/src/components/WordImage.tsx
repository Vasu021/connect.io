import { useState } from 'react';
import type { WordImageView } from '../lib/types';

type Size = 'seat' | 'chip' | 'podium';

/**
 * A picture for a word, from Pixabay.
 *
 * Support, never the subject: the word above it keeps all the emphasis, so this
 * stays small and slightly dimmed until hovered. If the image is missing or
 * fails to load it renders nothing at all — a broken frame would be worse than
 * no picture.
 */
export function WordImage({ image, size = 'seat' }: { image?: WordImageView; size?: Size }) {
  const [failed, setFailed] = useState(false);

  if (!image || failed) return null;

  const credit = image.photographer
    ? `“${image.tags ?? image.word}” by ${image.photographer} on Pixabay`
    : 'Image from Pixabay';

  const picture = (
    <img
      className={`word-image word-image-${size}`}
      src={`/api/images/${image.id}`}
      alt={image.tags ?? image.word}
      title={credit}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );

  // Clicking through to the source is how Pixabay asks to be credited.
  if (!image.pageUrl) return picture;

  return (
    <a
      className="word-image-link"
      href={image.pageUrl}
      target="_blank"
      rel="noopener noreferrer"
      tabIndex={-1}
      aria-label={credit}
    >
      {picture}
    </a>
  );
}

/** Shown once wherever images are on screen, as Pixabay's terms require. */
export function PixabayCredit() {
  return (
    <a
      className="pixabay-credit"
      href="https://pixabay.com/"
      target="_blank"
      rel="noopener noreferrer"
    >
      Images from Pixabay
    </a>
  );
}
