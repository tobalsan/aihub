import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import solid from "vite-plugin-solid";

const sharedSrc = fileURLToPath(
  new URL("./packages/shared/src/index.ts", import.meta.url)
);

export default defineConfig({
  plugins: [solid({ hot: false })],
  resolve: {
    alias: [
      { find: /^solid-js\/web$/, replacement: "solid-js/web/dist/web.js" },
      { find: /^solid-js$/, replacement: "solid-js/dist/solid.js" },
      { find: "@aihub/shared", replacement: sharedSrc },
    ],
  },
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    environmentMatchGlobs: [["apps/web/src/**/*.test.tsx", "jsdom"]],
    deps: {
      inline: ["solid-js", "solid-js/web"],
    },
  },
});
