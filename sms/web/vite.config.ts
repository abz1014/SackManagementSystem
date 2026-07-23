import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // dev: proxy API calls to the Express server so the SPA only ever calls /api
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
