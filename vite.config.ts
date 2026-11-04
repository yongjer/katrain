/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Tauri expects a fixed dev port and must not clear the terminal so Rust errors stay visible.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    // the Python package next to src/ holds large binaries and models
    watch: { ignored: [resolve(import.meta.dirname, "src-tauri") + "/**", resolve(import.meta.dirname, "katrain") + "/**"] },
  },
  build: {
    target: "es2022",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  test: {
    include: ["tests-ts/**/*.test.ts"],
  },
});
