import { defineConfig } from "vite";

export default defineConfig({
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
  },
});
