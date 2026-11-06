import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Carnet de suivi — ergothérapie",
        short_name: "Carnet2suivi",
        description: "Suivi des patients du cabinet, utilisable même sans connexion.",
        lang: "fr",
        start_url: ".",
        scope: ".",
        display: "standalone",
        orientation: "any",
        background_color: "#f7f5f0",
        theme_color: "#3d6b8f",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Toute l'application est mise en cache : elle s'ouvre sans réseau.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "index.html",
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // Les données patients ne passent JAMAIS par le cache du navigateur :
        // elles vivent dans la base locale de l'appareil (IndexedDB) et sur le serveur HDS.
        runtimeCaching: [],
      },
    }),
  ],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
