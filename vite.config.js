import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["favicon.ico", "favicon-16.png", "favicon-32.png", "apple-touch-icon.png"],
      manifest: {
        name: "Time Logger",
        short_name: "TimeLogger",
        start_url: "/",
        display: "standalone",
        background_color: "#0a0a0a",
        theme_color: "#FF7A1A",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" }
        ]
      },
      workbox: {
        // Cache the app shell so it opens instantly with zero connection.
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        // iOS Safari's PWA update check can be unreliable with the default
        // settings — these two make it check for a new version every time
        // the app is opened, instead of only occasionally.
        skipWaiting: true,
        clientsClaim: true,
      },
      devOptions: { enabled: false }
    })
  ],
  build: {
    modulePreload: {
      // Preload every chunk the entry needs EXCEPT the charts bundle.
      // Before, modulePreload:false skipped preloading for ALL chunks
      // (including firebase/auth+firestore), forcing the browser to
      // discover and fetch them one-by-one only after parsing the main
      // bundle — that serial waterfall is what was delaying auth/sync on
      // open. Now firebase + icons preload in parallel like normal, and
      // only the recharts/Statistics chunk stays lazy (fetched on demand
      // when that tab is opened), which is the only thing we actually
      // wanted to defer.
      resolveDependencies: (filename, deps) => deps.filter((dep) => !dep.includes("charts")),
    },
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ["recharts"],
          icons: ["lucide-react"],
          firebase: ["firebase/app", "firebase/auth", "firebase/firestore"],
        },
      },
    },
  },
});
