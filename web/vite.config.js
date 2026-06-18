import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
  },
  server: {
    proxy: {
      // During local dev, proxy /api calls to the local Functions host
      "/api": "http://localhost:7071",
    },
  },
});
