import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
export default defineConfig({
    plugins: [solid()],
    server: {
        port: 3000,
        proxy: {
            "/api": {
                target: "http://localhost:4000",
                changeOrigin: true,
            },
        },
    },
});
//# sourceMappingURL=vite.config.js.map