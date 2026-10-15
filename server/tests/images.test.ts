import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { TokenBucket } from '../src/images/bucket.js';
import type { PixabayClient, PixabayHit, SearchOutcome } from '../src/images/pixabay.js';
import {
  configureImages,
  ensureImage,
  imagesAreEnabled,
  onImageReady,
  readyImagesFor,
  resetImageState,
} from '../src/images/store.js';

const tempDir = path.join(os.tmpdir(), `connectio-images-${process.pid}`);

const HIT: PixabayHit = {
  id: 42,
  pageURL: 'https://pixabay.com/photos/ocean-42/',
  tags: 'ocean, sea, water',
  previewURL: 'https://cdn.pixabay.com/photo/ocean_150.jpg',
  previewWidth: 150,
  previewHeight: 100,
  user: 'seaphotographer',
  user_id: 7,
};

/** A stand-in for Pixabay that counts calls and never touches the network. */
function stubClient(
  outcome: SearchOutcome = { kind: 'hit', hit: HIT },
  options: { downloadFails?: boolean; delayMs?: number } = {},
): PixabayClient & { searches: string[]; downloads: number } {
  const stub = {
    searches: [] as string[],
    downloads: 0,
    async search(word: string) {
      stub.searches.push(word);
      if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
      return outcome;
    },
    async download() {
      stub.downloads += 1;
      if (options.downloadFails) return null;
      return { bytes: Buffer.from('fake-jpeg-bytes'), contentType: 'image/jpeg' };
    },
  };
  return stub;
}

beforeEach(async () => {
  await prisma.wordImage.deleteMany({});
  resetImageState();
  configureImages({ enabled: true, storeDir: tempDir, rateLimitPerMinute: 80 });
});

afterAll(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe('token bucket', () => {
  it('hands out up to its capacity and then refuses', () => {
    const bucket = new TokenBucket(3, 3, () => 0);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });

  it('refills over time', () => {
    let clock = 0;
    const bucket = new TokenBucket(60, 60, () => clock);
    for (let i = 0; i < 60; i += 1) bucket.tryTake();
    expect(bucket.tryTake()).toBe(false);

    clock = 30_000; // half a minute at 60/min = 30 tokens back
    expect(bucket.available()).toBe(30);
    expect(bucket.tryTake()).toBe(true);
  });

  it("believes Pixabay's count when it is lower than ours", () => {
    const bucket = new TokenBucket(80, 80, () => 0);
    bucket.syncRemaining(2);
    expect(bucket.available()).toBe(2);

    // A higher remote count never inflates our own.
    bucket.syncRemaining(500);
    expect(bucket.available()).toBe(2);
  });
});

describe('fetching and caching', () => {
  it('fetches once and stores the bytes on disk', async () => {
    const client = stubClient();
    configureImages({ client });

    const view = await ensureImage('Ocean');
    expect(view).not.toBeNull();
    expect(view?.photographer).toBe('seaphotographer');
    expect(view?.pageUrl).toBe(HIT.pageURL);

    const row = await prisma.wordImage.findUniqueOrThrow({ where: { word: 'ocean' } });
    expect(row.status).toBe('READY');
    // Pixabay forbids hotlinking, so the bytes must be ours.
    expect(row.filePath).toBeTruthy();
    const onDisk = await fs.readFile(path.join(tempDir, row.filePath as string));
    expect(onDisk.toString()).toBe('fake-jpeg-bytes');
  });

  it('serves a repeat from cache without calling Pixabay again', async () => {
    const client = stubClient();
    configureImages({ client });

    await ensureImage('ocean');
    expect(client.searches).toHaveLength(1);

    // Same word, different spelling — normalizeWord makes them one cache key.
    await ensureImage('  OCEAN ');
    expect(client.searches).toHaveLength(1);
  });

  it('collapses concurrent requests for the same word into one call', async () => {
    const client = stubClient({ kind: 'hit', hit: HIT }, { delayMs: 30 });
    configureImages({ client });

    await Promise.all([ensureImage('storm'), ensureImage('storm'), ensureImage('STORM')]);
    expect(client.searches).toHaveLength(1);
    expect(client.downloads).toBe(1);
  });

  it('remembers a word Pixabay has nothing for and stops asking', async () => {
    const client = stubClient({ kind: 'none' });
    configureImages({ client });

    expect(await ensureImage('zyzzyvaqux')).toBeNull();
    expect(await ensureImage('zyzzyvaqux')).toBeNull();

    expect(client.searches).toHaveLength(1);
    const row = await prisma.wordImage.findUniqueOrThrow({ where: { word: 'zyzzyvaqux' } });
    expect(row.status).toBe('NONE');
    expect(row.nextRetryAt).not.toBeNull();
  });

  it('backs off after an error rather than hammering', async () => {
    const client = stubClient({ kind: 'error', message: 'boom' });
    configureImages({ client });

    expect(await ensureImage('thunder')).toBeNull();
    const row = await prisma.wordImage.findUniqueOrThrow({ where: { word: 'thunder' } });
    expect(row.status).toBe('FAILED');
    expect(row.attempts).toBe(1);
    expect((row.nextRetryAt as Date).getTime()).toBeGreaterThan(Date.now());

    // Inside the backoff window it does not try again.
    await ensureImage('thunder');
    expect(client.searches).toHaveLength(1);
  });

  it('treats being rate limited as temporary, not as failure of the word', async () => {
    const client = stubClient({ kind: 'rate_limited' });
    configureImages({ client });

    expect(await ensureImage('rain')).toBeNull();
    const row = await prisma.wordImage.findUniqueOrThrow({ where: { word: 'rain' } });
    expect(row.status).toBe('FAILED');
    expect((row.nextRetryAt as Date).getTime()).toBeLessThanOrEqual(Date.now() + 61_000);
  });

  it('does not record an image when the download fails', async () => {
    const client = stubClient({ kind: 'hit', hit: HIT }, { downloadFails: true });
    configureImages({ client });

    expect(await ensureImage('cliff')).toBeNull();
    const row = await prisma.wordImage.findUniqueOrThrow({ where: { word: 'cliff' } });
    expect(row.status).toBe('FAILED');
    expect(row.filePath).toBeNull();
  });

  it('stops asking once the minute budget is spent', async () => {
    const client = stubClient();
    configureImages({ client, rateLimitPerMinute: 2 });

    await ensureImage('one');
    await ensureImage('two');
    await ensureImage('three');

    // Two tokens, two calls — the third word waits for the bucket to refill.
    expect(client.searches).toHaveLength(2);
  });

  it('notifies listeners when an image becomes ready', async () => {
    const client = stubClient();
    configureImages({ client });

    const seen: string[] = [];
    const off = onImageReady((view) => seen.push(view.word));

    await ensureImage('harbour');
    expect(seen).toEqual(['harbour']);
    off();
  });

  it('looks up ready images in bulk for a reveal payload', async () => {
    configureImages({ client: stubClient() });
    await ensureImage('alpha');
    await ensureImage('bravo');

    const map = await readyImagesFor(['Alpha', 'bravo', 'never-fetched']);
    expect([...map.keys()].sort()).toEqual(['alpha', 'bravo']);
  });
});

describe('when the feature is switched off', () => {
  it('does nothing at all without an API key', async () => {
    const client = stubClient();
    configureImages({ client, enabled: false });

    expect(imagesAreEnabled()).toBe(false);
    expect(await ensureImage('ocean')).toBeNull();
    expect(client.searches).toHaveLength(0);
    expect(await prisma.wordImage.count()).toBe(0);
  });
});
