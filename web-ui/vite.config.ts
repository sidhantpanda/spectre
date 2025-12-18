import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

declare const process: { env?: Record<string, string | undefined> };

const CONTROL_SERVER_TARGET =
  (typeof process !== "undefined" ? process.env?.CONTROL_SERVER_TARGET : undefined) ||
  "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/agents": {
        target: CONTROL_SERVER_TARGET,
        changeOrigin: true,
        ws: true,
        secure: false,
      },
      "/agents/events": {
        target: CONTROL_SERVER_TARGET,
        changeOrigin: true,
        ws: true,
        secure: false,
      },
      "/terminal": {
        target: CONTROL_SERVER_TARGET,
        changeOrigin: true,
        ws: true,
        secure: false,
      },
      "/version": {
        target: CONTROL_SERVER_TARGET,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/setupTests.ts",
  },
});
