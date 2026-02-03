import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const sharedSrc = fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@aihub/shared": sharedSrc,
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});
