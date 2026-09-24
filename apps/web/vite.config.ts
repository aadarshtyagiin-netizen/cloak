import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Accept requests via ngrok / LAN IP / any tunnel host in dev. The API and
    // websocket are proxied below, so a single tunnel to :5173 serves the whole
    // app same-origin (which keeps the httpOnly refresh cookie working).
    host: true,
    allowedHosts: true,
    proxy: {
      // Proxy API + websocket to the Fastify server in dev so cookies are same-origin.
      '/v1': { target: 'http://localhost:4000', changeOrigin: true },
      // Socket.IO uses the /socket.io transport path (the /rt namespace rides on top).
      '/socket.io': { target: 'http://localhost:4000', ws: true, changeOrigin: true },
      '/health': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
