import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("./static", import.meta.url)),
  base: "/salton-safra-inteligente/",
  plugins: [react()],
  css: {
    postcss: fileURLToPath(new URL("./postcss.config.mjs", import.meta.url)),
  },
  resolve: {
    alias: { "@": projectRoot },
  },
  build: {
    outDir: fileURLToPath(new URL("./.static-dist", import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
});
