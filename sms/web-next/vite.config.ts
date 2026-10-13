import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // explicit root so `vite build --config web-next/vite.config.ts` works from sms/
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/next/',
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': process.env.SMS_API_PROXY ?? 'http://localhost:4000',
    },
  },
  build: { outDir: 'dist' },
});
