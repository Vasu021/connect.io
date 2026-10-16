import type { ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = process.env.VITE_PROXY_TARGET ?? 'http://localhost:4000';

/**
 * A browser that navigates away or closes a tab mid-request leaves the proxy
 * writing to a socket nobody is reading. http-proxy surfaces that as an
 * unhandled 'error' event, which by default takes the entire dev server down —
 * and it happens readily now that images stream through the proxy.
 *
 * Swallowing an aborted request is the correct response: there is no client
 * left to tell.
 */
function tolerateAbortedRequests(extra: ProxyOptions = {}): ProxyOptions {
  return {
    target: API_TARGET,
    changeOrigin: true,
    ...extra,
    configure(proxy) {
      proxy.on('error', (err) => {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ERR_STREAM_WRITE_AFTER_END') {
          return;
        }
        console.warn(`[proxy] ${err.message}`);
      });
      proxy.on('proxyRes', (proxyRes, _req, res) => {
        // The response socket can also fail after the proxy has handed off.
        res.on('error', () => undefined);
        proxyRes.on('error', () => undefined);
      });
    },
  };
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxying means the browser only ever talks to one origin in development,
    // so the session cookie is first-party and CORS never enters the picture.
    proxy: {
      '/api': tolerateAbortedRequests(),
      '/socket.io': tolerateAbortedRequests({ ws: true }),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
