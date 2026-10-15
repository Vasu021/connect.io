/**
 * The Pixabay side of the image feature, kept behind an interface so tests can
 * substitute it and never touch the network.
 */
export type PixabayHit = {
  id: number;
  pageURL: string;
  tags: string;
  previewURL: string;
  previewWidth: number;
  previewHeight: number;
  user: string;
  user_id: number;
};

export type SearchOutcome =
  | { kind: 'hit'; hit: PixabayHit }
  | { kind: 'none' }
  | { kind: 'rate_limited' }
  | { kind: 'error'; message: string };

export type Downloaded = { bytes: Buffer; contentType: string };

export interface PixabayClient {
  search(word: string): Promise<SearchOutcome>;
  download(url: string): Promise<Downloaded | null>;
}

type RemainingListener = (remaining: number) => void;

const SEARCH_ENDPOINT = 'https://pixabay.com/api/';
/** Preview images cap at 150px — the right size for a small box beside a word. */
const PER_PAGE = 20;
/**
 * Pixabay returns results by popularity, which tracks relevance closely. Taking
 * a random pick from all twenty produced some odd choices — a statue for
 * "hurricane" — so sample from the top handful instead: still varied between
 * games, but recognisably the word.
 */
const CANDIDATE_POOL = 6;

export function createPixabayClient(
  apiKey: string,
  options: {
    fetchImpl?: typeof fetch;
    onRemaining?: RemainingListener;
  } = {},
): PixabayClient {
  const doFetch = options.fetchImpl ?? fetch;

  return {
    async search(word) {
      const url = new URL(SEARCH_ENDPOINT);
      url.searchParams.set('key', apiKey);
      url.searchParams.set('q', word);
      url.searchParams.set('image_type', 'photo');
      // The only content filter Pixabay offers. It is not a guarantee.
      url.searchParams.set('safesearch', 'true');
      url.searchParams.set('per_page', String(PER_PAGE));
      url.searchParams.set('order', 'popular');

      let response: Response;
      try {
        response = await doFetch(url, { signal: AbortSignal.timeout(8_000) });
      } catch (err) {
        return { kind: 'error', message: (err as Error).message };
      }

      const remaining = Number(response.headers.get('X-RateLimit-Remaining'));
      if (Number.isFinite(remaining)) options.onRemaining?.(remaining);

      if (response.status === 429) return { kind: 'rate_limited' };
      if (!response.ok) return { kind: 'error', message: `HTTP ${response.status}` };

      let payload: { hits?: PixabayHit[] };
      try {
        payload = (await response.json()) as { hits?: PixabayHit[] };
      } catch (err) {
        return { kind: 'error', message: (err as Error).message };
      }

      const hits = (payload.hits ?? []).filter((hit) => Boolean(hit?.previewURL));
      if (hits.length === 0) return { kind: 'none' };

      // Random within the pool, so a recurring word is not always the same
      // picture, but never so far down the list that relevance suffers.
      const pool = hits.slice(0, CANDIDATE_POOL);
      const hit = pool[Math.floor(Math.random() * pool.length)] as PixabayHit;
      return { kind: 'hit', hit };
    },

    async download(url) {
      try {
        const response = await doFetch(url, { signal: AbortSignal.timeout(8_000) });
        if (!response.ok) return null;

        const contentType = response.headers.get('content-type') ?? 'image/jpeg';
        if (!contentType.startsWith('image/')) return null;

        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length === 0) return null;

        return { bytes, contentType };
      } catch {
        return null;
      }
    },
  };
}
