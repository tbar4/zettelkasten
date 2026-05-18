import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    tanstackRouter({ autoCodeSplitting: true }),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png}"]
      },
      manifest: {
        name: "Zettel",
        short_name: "Zettel",
        theme_color: "#1a1b26",
        display: "standalone",
        start_url: "/m/capture"
      }
    })
  ],
  server: {
    // In Docker, Vite must bind 0.0.0.0 to be reachable through the published port.
    // Outside Docker this is harmless; both `localhost:5173` and the LAN IP work.
    host: true,
    port: 5173,
    // HMR needs polling when the source is on a bind-mounted host volume
    // (filesystem events don't propagate reliably through the Docker VM).
    watch: process.env.CHOKIDAR_USEPOLLING
      ? { usePolling: true, interval: 300 }
      : undefined,
    proxy: {
      // Inside the api compose service this resolves to the api container.
      // Outside Docker, default to localhost. Override with API_PROXY_TARGET.
      "/api": process.env.API_PROXY_TARGET ?? "http://localhost:3001"
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"]
  }
});
