import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 本机开发时：npm run dev，接口和照片代理到本地起的 section-svc
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
    },
  },
});
