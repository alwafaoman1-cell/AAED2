import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null, // we register manually with iframe guard in main.tsx
      devOptions: { enabled: false },
      includeAssets: ["icon-192.png", "icon-512.png"],
      manifest: false, // use existing public/manifest.json
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/~oauth/, /^\/api/, /^\/functions/, /^\/auth/],
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        globPatterns: ["**/*.{js,css,html,svg,png,jpg,jpeg,webp,woff2}"],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        runtimeCaching: [
          {
            // HTML navigations: always try network. Cache is ONLY a last-resort offline fallback.
            // Short maxAge prevents serving a stale shell that references deleted chunks → 404 على المسارات الجديدة.
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "html-shell",
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 2, maxAgeSeconds: 30 },
            },
          },
          {
            // Supabase REST GETs — SWR for instant paint + background refresh.
            // Writes (POST/PATCH/DELETE) bypass cache automatically (Workbox only caches GET).
            // Only cache real 200 OK responses (drop opaque/0) so 401/403 from RLS denials are never re-served.
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "supabase-rest",
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 10 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Supabase Auth / Realtime / Functions — never cache (always live)
            urlPattern: /^https:\/\/.*\.supabase\.co\/(auth|realtime|functions)\/.*/i,
            handler: "NetworkOnly",
          },
          {
            // Supabase Storage public assets — long cache, immutable-ish
            urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/public\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "supabase-storage",
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
  build: {
    // Vendor splitting — keeps the initial route chunk small. Heavy libs
    // (jspdf, html2canvas, recharts) load only when the page that uses them does.
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "query-vendor": ["@tanstack/react-query"],
          "supabase": ["@supabase/supabase-js"],
          "pdf": ["jspdf", "jspdf-autotable", "html2canvas"],
          "charts": ["recharts"],
          "i18n": ["i18next", "react-i18next", "i18next-browser-languagedetector"],
        },
      },
    },
  },
}));

