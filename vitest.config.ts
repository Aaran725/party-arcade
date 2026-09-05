import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
    },
  },
  test: {
    // Server tests stay on node — deliberately NOT a global flip to jsdom, which would
    // drag server/protocol/handlers.integration.test.ts (real ws sockets) into a fake DOM.
    environment: "node",
    // Client code under src/ needs a DOM to be testable at all. Note jsdom has no canvas
    // 2D context, so anything touching createStageCanvas still isn't reachable here —
    // shared game logic is kept DOM-free precisely so it can be tested without one.
    environmentMatchGlobs: [["src/**", "jsdom"]],
  },
});
