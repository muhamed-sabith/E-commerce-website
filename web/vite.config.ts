/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.VITE_API_URL ?? "http://localhost:4000";

export default defineConfig({
  plugins: [react()],
  build: {
    // Hashed bundles live under /static so they never collide with
    // /assets/products/* (product images, served by the API).
    assetsDir: "static",
    // No source maps in the production bundle (the web server also refuses .map).
    sourcemap: false,
  },
  server: {
    port: 5173,
    // Product images, sitemap and robots live with the API; the same paths are
    // proxied by the production web server (server/serve.mjs).
    proxy: {
      "/assets": { target: apiTarget, changeOrigin: false },
      "/sitemap.xml": { target: apiTarget, changeOrigin: false },
      "/robots.txt": { target: apiTarget, changeOrigin: false },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts",
    include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.ts"],
  },
});