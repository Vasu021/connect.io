import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    // Every file talks to the same Postgres database, so they must not overlap.
    fileParallelism: false,
    testTimeout: 25_000,
    hookTimeout: 25_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://connectio:connectio_dev@localhost:5433/connectio_test?schema=public',
      JWT_SECRET: 'test-secret-at-least-thirty-two-characters-long-for-sure',
      CLIENT_ORIGIN: 'http://localhost:5173',
      // Run the real engine at millisecond speed rather than 15-second rounds.
      ROUND_DURATION_MS: '700',
      REVEAL_PAUSE_MS: '150',
      RECONNECT_GRACE_MS: '600',
      PRESENCE_ANNOUNCE_DELAY_MS: '120',
      MAX_ROUNDS: '3',
    },
  },
});
