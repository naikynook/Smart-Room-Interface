import { defineConfig } from "vite";
import { resolve } from "path";

// Relative base so GitHub Pages works from a project URL
// (e.g. https://user.github.io/Smart-Room-Interface/) and from the site root.
export default defineConfig({
  base: "./",
  server: {
    // OneDrive often locks large assets and crashes Vite's file watcher
    watch: {
      ignored: ["**/public/models/**", "**/public/data/**", "**/dist/**"],
    },
  },
  optimizeDeps: {
    include: [
      "three",
      "d3",
      "@tensorflow/tfjs",
      "@tensorflow/tfjs-backend-wasm",
      "@tensorflow-models/coco-ssd",
    ],
  },
  build: {
    chunkSizeWarningLimit: 3000,
    outDir: "dist",
    assetsDir: "assets",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        dataViz: resolve(__dirname, "data-viz.html"),
      },
    },
  },
});
