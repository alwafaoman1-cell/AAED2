import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// Collect the entry's STATIC import closure, not every lazy page or worker.
// Build metadata keeps this correct when shared chunk names/dependencies change.
function coreAppShell(coreAssets: Set<string>): Plugin {
  return {
    name: "core-app-shell-precache",
    apply: "build",
    generateBundle(_options, bundle) {
      coreAssets.clear();
      const visit = (fileName: string) => {
        if (coreAssets.has(fileName)) return;
        const entry = bundle[fileName];
        if (!entry) return;
        coreAssets.add(fileName);
        if (entry.type !== "chunk") return;
        entry.imports.forEach(visit);
        const metadata = (entry as typeof entry & {
          viteMetadata?: { importedCss: Set<string>; importedAssets: Set<string> };
        }).viteMetadata;
        metadata?.importedCss.forEach(visit);
        metadata?.importedAssets.forEach(visit);
      };
      Object.values(bundle).forEach((entry) => {
        // Registration is intentionally dynamically imported by registerPwa.ts,
        // but it is startup/update infrastructure, not an optional route.
        if (entry.type === "chunk" && (entry.isEntry || entry.moduleIds?.some((id) => id.includes("virtual:pwa-register")))) {
          visit(entry.fileName);
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const coreAssets = new Set<string>();
  return {
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
    coreAppShell(coreAssets),
    VitePWA({
      registerType: "prompt",
      injectRegister: null, // we register manually with iframe guard in main.tsx
      devOptions: { enabled: false },
      includeAssets: ["icon-192.png", "icon-512.png"],
      manifest: false, // use existing public/manifest.json
      workbox: {
        // No precache NavigationRoute: index.html is deliberately network-first.
        // A precache fallback here would shadow runtime navigation (and reference
        // a non-precached URL). The runtime rule below owns the offline shell.
        navigateFallback: undefined,
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        // Do not precache index.html. The app shell must be fetched from the
        // network on deploy so aaed-2.vercel.app cannot stay pinned to an old
        // hashed bundle through the Service Worker.
        globPatterns: ["assets/**/*.{js,css,svg,png,jpg,jpeg,webp,woff,woff2,ttf,otf}", "icon-192.png", "icon-512.png", "manifest.json"],
        manifestTransforms: [async (entries) => {
          if (coreAssets.size === 0) throw new Error("Cannot precache the offline shell without startup bundle metadata");
          return {
            manifest: entries.filter((entry) =>
              coreAssets.has(entry.url) || ["icon-192.png", "icon-512.png", "manifest.json"].includes(entry.url)),
            warnings: [],
          };
        }],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        runtimeCaching: [
          {
            // Wait for the network; only an actual failure uses the offline shell.
            // All app routes share one key so an offline route need not have been
            // visited before. API/auth callback URLs are never shell responses.
            urlPattern: ({ request, url, sameOrigin }) => sameOrigin && request.mode === "navigate" &&
              !/^\/(?:~oauth|api|functions|auth)(?:\/|$)/.test(url.pathname),
            handler: "NetworkFirst",
            options: {
              cacheName: "html-shell",
              plugins: [{
                cacheKeyWillBeUsed: async ({ request }) => new URL("/index.html", request.url).href,
              }],
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Hashed lazy chunks/styles/fonts are stored only after use. Never
            // match external scripts, HTML, signed storage or operational data.
            urlPattern: ({ url, sameOrigin }) => sameOrigin &&
              /^\/assets\/.+-[\w-]+\.(?:js|css|woff2?|ttf|otf|svg|png|jpe?g|webp)$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "temo-runtime-assets",
              expiration: { maxEntries: 160, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Supabase REST is operational data. Never cache it in the Service Worker.
            // This prevents claims/work orders/accounting lists from showing stale rows
            // after saves, deletes, restores, or tenant-filter changes.
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/i,
            handler: "NetworkOnly",
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
    // Preserve the Vite 5 browser baseline during the security toolchain
    // upgrade; do not silently drop older workshop tablets/Safari support.
    target: ["es2020", "edge88", "firefox78", "chrome87", "safari14"],
    // Keep only genuinely shared startup vendors here. Rollup's object-form
    // manualChunks also pulls in dependencies of each entry: assigning PDF or
    // Recharts here dragged the preload helper / clsx into those chunks, so
    // both large libraries were preloaded even on the auth page. Let Vite
    // split them naturally at their lazy route boundaries instead.
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "query-vendor": ["@tanstack/react-query"],
          "supabase": ["@supabase/supabase-js"],
          "i18n": ["i18next", "react-i18next", "i18next-browser-languagedetector"],
        },
      },
    },
  },
  };
});
