import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The web app never talks to the kernel directly — it talks to the thin API in
// ../src/server.ts, proxied here so the browser sees one origin in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? process.env.PORT ?? 5173),
    proxy: { '/api': { target: `http://localhost:${process.env.API_PORT ?? 8871}`, changeOrigin: true } },
  },
});
