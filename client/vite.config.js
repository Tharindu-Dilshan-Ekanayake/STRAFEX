import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

import { PROD_ENV } from './src/bloxity/env.js'

/** A local Boxity stack: the API, the play (matchmaker) service and the portal. */
const LOCAL_BLOXITY_ENV = {
  env: 'local',
  apiUrl: 'http://localhost:4000',
  playUrl: 'http://localhost:2567',
  portalUrl: 'http://localhost:3000',
  staticUrl: PROD_ENV.staticUrl,
}

/**
 * `vite dev` only (`apply: 'serve'`, never in a build): tells the Boxity SDK - and
 * src/bloxity/env.js - which environment to use, by injecting `window.BLOXITY_ENV`
 * ahead of every other script (so ahead of the SDK tag).
 *
 * Defaults to a local Boxity stack. `BLOXITY_DEV_ENV=prod npm run dev` develops
 * against production instead: then the production environment is injected explicitly,
 * because with no BLOXITY_ENV at all the SDK, seeing localhost, would repoint its API
 * and login at the Vite server and login could never succeed.
 *
 * Production builds get nothing: the page Boxity hosts the game in provides it, or the
 * SDK uses production.
 */
function bloxityDevEnv() {
  return {
    name: 'bloxity-dev-env',
    apply: 'serve',
    transformIndexHtml() {
      const env = process.env.BLOXITY_DEV_ENV === 'prod' ? PROD_ENV : LOCAL_BLOXITY_ENV
      return [
        {
          tag: 'script',
          children: `window.BLOXITY_ENV = ${JSON.stringify(env)};`,
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [bloxityDevEnv(), react(), tailwindcss()],
  resolve: {
    alias: {
      // Game rules and world layout, shared with the server.
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  // The offline host runs in a module worker (net/hostWorker.js) importing ../shared.
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      output: {
        // Libraries in their own long-cached chunk: a game update re-downloads only the
        // (much smaller) game code. three's examples (loaders) stay with the lazy chunks
        // that use them.
        advancedChunks: {
          groups: [{ name: 'vendor', test: /node_modules[\\/](three[\\/](?!examples)|(react|react-dom|scheduler|@react-three|zustand|its-fine|suspend-react)[\\/])/ }],
        },
      },
    },
    // three + React + R3F is one ~1 MB (~300 KB gzip) chunk on purpose.
    chunkSizeWarningLimit: 1200,
  },
  server: {
    // ../shared lives outside the client root.
    fs: { allow: ['..'] },
  },
  optimizeDeps: {
    // Dev-only perf overlay, imported lazily; pre-bundle it so the first ?perf load
    // doesn't hit a mid-session dependency re-optimisation.
    include: ['r3f-perf'],
  },
})
