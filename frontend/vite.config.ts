import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import packageJson from "./package.json" assert { type: "json" };

export default defineConfig(({ mode }: { mode: string }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = env.VITE_BASE_PATH && env.VITE_BASE_PATH.trim().length > 0 ? env.VITE_BASE_PATH : "/";
  return {
    base,
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version ?? "0.0.0"),
    },
    server: {
      port: 5173,
      proxy: env.VITE_API_BASE_URL
        ? {
            "/api": {
              target: env.VITE_API_BASE_URL,
              changeOrigin: true,
              rewrite: (path: string) => path.replace(/^\/api/, ""),
            },
          }
        : undefined,
    },
    preview: {
      port: 4173,
    },
  };
});
