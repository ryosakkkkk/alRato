/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'alRato — snap now, understand later',
        short_name: 'alRato',
        scope: '/',
        display_override: ['standalone', 'minimal-ui'],
        // Long-press on the installed app's icon: straight to the camera.
        shortcuts: [
          {
            name: 'Capture the board',
            short_name: 'Capture',
            url: '/#/capture',
            icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'My library',
            short_name: 'Library',
            url: '/#/library',
            icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
        description:
          'Photograph the board in class. alRato turns it into hints, connections to your own notes and spaced practice, on your device when it can and in the cloud when it must.',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        lang: 'en',
        categories: ['education', 'productivity'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The phone's local model runtime is large and optional: it is cached the first time it is used.
        globIgnores: ['**/webllm-*.js'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/assets\/webllm-[^/]+\.js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'alrato-local-model-runtime', expiration: { maxEntries: 4 } },
          },
        ],
      },
    }),
  ],
  // Explicit, so Vite does not pick up a PostCSS config from a parent folder.
  css: { postcss: { plugins: [] } },
  // .local holds browser profiles, test builds and caches that change constantly.
  server: { watch: { ignored: ['**/.local/**'] } },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // The local model runtime gets a stable name, so the service worker can cache it on first use.
        manualChunks: (id) => (id.includes('@mlc-ai/web-llm') ? 'webllm' : undefined),
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Test the browser build of the SDK. Its Node build has no on-device adapter at all.
    alias: {
      '@firebase/ai': fileURLToPath(new URL('./node_modules/@firebase/ai/dist/esm/index.esm.js', import.meta.url)),
    },
    server: { deps: { inline: [/firebase/] } },
  },
});
