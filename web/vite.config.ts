/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Product images live with the API (admin uploads); same path in production via nginx.
    proxy: {
      "/assets": { target: process.env.VITE_API_URL ?? "http://localhost:4000", changeOrigin: false },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts",
  },
});
