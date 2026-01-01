import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  build: {
    rollupOptions: {
      input: "./index.html",
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      "/ws": {
        target: "http://localhost:4000",
        ws: true,
      },
    },
  },
});
