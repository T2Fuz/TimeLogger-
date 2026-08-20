import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico"],
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
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"]
      }
    })
  ]
});
