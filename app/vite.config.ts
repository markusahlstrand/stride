import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The web app never talks to the kernel directly — it talks to the thin API in
// ../src/server.ts, proxied here so the browser sees one origin in dev.
//
// `changeOrigin` is deliberately OFF. The OIDC provider derives its redirect URI
// from the request's own origin, so rewriting Host to the API port would send the
// browser to :8871 after sign-in and strand it there, outside the app. Leaving the
// Host alone keeps the whole round trip on :5173, which is also what a deployed
// instance sees: one origin, app and callback on the same host.
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? process.env.PORT ?? 5173),
    proxy: { '/api': { target: `http://localhost:${process.env.API_PORT ?? 8871}` } },
  },
});
