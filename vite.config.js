import { defineConfig } from "vite";

// Relative base so GitHub Pages works from a project URL
// (e.g. https://user.github.io/Smart-Room-Interface/) and from the site root.
export default defineConfig({
  base: "./",
  server: {
    // OneDrive often locks .glb files and crashes Vite's file watcher
    watch: {
      ignored: ["**/public/models/**", "**/dist/**"],
    },
  },
  optimizeDeps: {
    include: [
      "three",
      "@tensorflow/tfjs",
      "@tensorflow/tfjs-backend-wasm",
      "@tensorflow-models/coco-ssd",
    ],
  },
  build: {
    chunkSizeWarningLimit: 3000,
    outDir: "dist",
    assetsDir: "assets",
  },
});
