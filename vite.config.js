import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backend = "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/ads": backend,
      "/admin": backend,
      "/faces": backend,
      "/payments": backend,
      "/search": backend,
      "/search-results": backend,
      "/videos": backend,
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 8000,
  },
});
