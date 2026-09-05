import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        play: path.resolve(__dirname, "play.html"),
        spectate: path.resolve(__dirname, "spectate.html"),
      },
    },
  },
  appType: "custom",
});
