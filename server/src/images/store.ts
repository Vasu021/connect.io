import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { WordImage } from '@prisma/client';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { normalizeWord } from '../game/words.js';
import { TokenBucket } from './bucket.js';
import { createPixabayClient, type PixabayClient } from './pixabay.js';

export type WordImageView = {
  id: string;
  word: string;
  photographer: string | null;
  photographerUrl: string | null;
  pageUrl: string | null;
  tags: string | null;
  width: number | null;
  height: number | null;
};

type ReadyListener = (view: WordImageView) => void;

/** A word Pixabay has nothing for is unlikely to acquire anything soon. */
const NONE_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
/** Backoff after a failure, squared per attempt and capped. */
const FAILURE_BASE_MS = 60_000;
const FAILURE_CAP_MS = 60 * 60 * 1000;
/** Being throttled is temporary; come back shortly. */
const RATE_LIMIT_RETRY_MS = 60_000;

let client: PixabayClient | null = null;
let bucket = new TokenBucket(env.PIXABAY_RATE_LIMIT_PER_MINUTE);
let storeDir = path.resolve(process.cwd(), env.IMAGE_STORE_DIR);
let enabled = env.imagesEnabled;

/** Requests already in flight, so two games saying "storm" make one call. */
const inFlight = new Map<string, Promise<WordImageView | null>>();
const listeners = new Set<ReadyListener>();

function defaultClient(): PixabayClient | null {
  if (!env.PIXABAY_API_KEY) return null;
  return createPixabayClient(env.PIXABAY_API_KEY, {
    onRemaining: (remaining) => bucket.syncRemaining(remaining),
  });
}

client = defaultClient();

/** Swaps the Pixabay client and store location — used by tests. */
export function configureImages(options: {
  client?: PixabayClient | null;
  enabled?: boolean;
  storeDir?: string;
  rateLimitPerMinute?: number;
}): void {
  if (options.client !== undefined) client = options.client;
  if (options.enabled !== undefined) enabled = options.enabled;
  if (options.storeDir !== undefined) storeDir = path.resolve(options.storeDir);
  if (options.rateLimitPerMinute !== undefined) {
    bucket = new TokenBucket(options.rateLimitPerMinute);
  }
  inFlight.clear();
}

export function imagesAreEnabled(): boolean {
  return enabled && client !== null;
}

export function onImageReady(listener: ReadyListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function imageStoreDir(): string {
  return storeDir;
}

export function tokensAvailable(): number {
  return bucket.available();
}

function toView(row: WordImage): WordImageView {
  return {
    id: row.id,
    word: row.word,
    photographer: row.photographer,
    photographerUrl: row.photographerUrl,
    pageUrl: row.pageUrl,
    tags: row.tags,
    width: row.width,
    height: row.height,
  };
}

function extensionFor(contentType: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  return 'jpg';
}

function fileNameFor(word: string, contentType: string): string {
  const hash = createHash('sha256').update(word).digest('hex');
  return `${hash}.${extensionFor(contentType)}`;
}

/** True when a row is settled and should not be fetched again right now. */
function isSettled(row: WordImage, at: number): boolean {
  if (row.status === 'READY') return true;
  if (row.nextRetryAt && row.nextRetryAt.getTime() > at) return true;
  return false;
}

async function fetchAndStore(word: string): Promise<WordImageView | null> {
  const active = client;
  if (!active) return null;

  // Spending a token we do not have would be the thing that gets the key
  // throttled, so skip and let a later round try again.
  if (!bucket.tryTake()) {
    await prisma.wordImage.updateMany({
      where: { word },
      data: { nextRetryAt: new Date(Date.now() + RATE_LIMIT_RETRY_MS) },
    });
    return null;
  }

  const outcome = await active.search(word);

  if (outcome.kind === 'none') {
    await prisma.wordImage.update({
      where: { word },
      data: {
        status: 'NONE',
        fetchedAt: new Date(),
        nextRetryAt: new Date(Date.now() + NONE_RETRY_MS),
      },
    });
    return null;
  }

  if (outcome.kind === 'rate_limited' || outcome.kind === 'error') {
    const row = await prisma.wordImage.update({
      where: { word },
      data: {
        status: 'FAILED',
        attempts: { increment: 1 },
        fetchedAt: new Date(),
      },
    });
    const backoff =
      outcome.kind === 'rate_limited'
        ? RATE_LIMIT_RETRY_MS
        : Math.min(FAILURE_CAP_MS, FAILURE_BASE_MS * row.attempts * row.attempts);
    await prisma.wordImage.update({
      where: { word },
      data: { nextRetryAt: new Date(Date.now() + backoff) },
    });
    return null;
  }

  const { hit } = outcome;
  const downloaded = await active.download(hit.previewURL);

  if (!downloaded) {
    const row = await prisma.wordImage.update({
      where: { word },
      data: { status: 'FAILED', attempts: { increment: 1 }, fetchedAt: new Date() },
    });
    await prisma.wordImage.update({
      where: { word },
      data: {
        nextRetryAt: new Date(
          Date.now() + Math.min(FAILURE_CAP_MS, FAILURE_BASE_MS * row.attempts * row.attempts),
        ),
      },
    });
    return null;
  }

  // Pixabay forbids hotlinking and their URLs expire after a day, so the bytes
  // live with us from here on.
  const fileName = fileNameFor(word, downloaded.contentType);
  await fs.mkdir(storeDir, { recursive: true });
  await fs.writeFile(path.join(storeDir, fileName), downloaded.bytes);

  const saved = await prisma.wordImage.update({
    where: { word },
    data: {
      status: 'READY',
      pixabayId: hit.id,
      photographer: hit.user,
      photographerUrl: `https://pixabay.com/users/${hit.user}-${hit.user_id}/`,
      pageUrl: hit.pageURL,
      tags: hit.tags,
      filePath: fileName,
      contentType: downloaded.contentType,
      width: hit.previewWidth,
      height: hit.previewHeight,
      bytes: downloaded.bytes.length,
      fetchedAt: new Date(),
      nextRetryAt: null,
    },
  });

  const view = toView(saved);
  for (const listener of listeners) {
    try {
      listener(view);
    } catch (err) {
      console.error('image listener failed:', err);
    }
  }
  return view;
}

/**
 * Returns the cached image for a word, fetching it if we have never looked.
 * Resolves to null whenever there is no picture to show — which the caller is
 * always free to ignore, because the game never depends on one.
 */
export async function ensureImage(rawWord: string): Promise<WordImageView | null> {
  if (!imagesAreEnabled()) return null;

  const word = normalizeWord(rawWord);
  if (!word) return null;

  const existing = inFlight.get(word);
  if (existing) return existing;

  const task = (async () => {
    const now = Date.now();

    const row = await prisma.wordImage.upsert({
      where: { word },
      create: { word, status: 'PENDING' },
      update: {},
    });

    if (row.status === 'READY') return toView(row);
    if (isSettled(row, now)) return null;

    return fetchAndStore(word);
  })()
    .catch((err) => {
      console.error(`image fetch failed for "${word}":`, err);
      return null;
    })
    .finally(() => {
      inFlight.delete(word);
    });

  inFlight.set(word, task);
  return task;
}

/** Fire-and-forget. Nothing in the game loop may ever await an image. */
export function requestImage(rawWord: string): void {
  if (!imagesAreEnabled()) return;
  void ensureImage(rawWord);
}

/** Ready images for a set of words, for building reveal payloads. */
export async function readyImagesFor(words: readonly string[]): Promise<Map<string, WordImageView>> {
  const normalized = [...new Set(words.map(normalizeWord).filter(Boolean))];
  if (normalized.length === 0) return new Map();

  const rows = await prisma.wordImage.findMany({
    where: { word: { in: normalized }, status: 'READY' },
  });

  return new Map(rows.map((row) => [row.word, toView(row)]));
}

export async function findReadyImageById(id: string): Promise<WordImage | null> {
  const row = await prisma.wordImage.findUnique({ where: { id } });
  return row && row.status === 'READY' && row.filePath ? row : null;
}

/** Test helper: forget in-flight work and listeners between cases. */
export function resetImageState(): void {
  inFlight.clear();
  listeners.clear();
  bucket = new TokenBucket(env.PIXABAY_RATE_LIMIT_PER_MINUTE);
}
