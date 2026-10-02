import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // dev: proxy API calls to the Express server so the SPA only ever calls /api.
    // Defaults to API_PORT's usual 4000; set SMS_API_PROXY (e.g. http://localhost:4100)
    // when the API was started on a different port.
    proxy: {
      '/api': process.env.SMS_API_PROXY ?? 'http://localhost:4000',
    },
  },
});
