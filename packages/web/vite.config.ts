import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  // 静态产物统一挂在 /admin 路径下，由 Nginx 托管
  base: '/admin/',
  plugins: [vue()],
  server: {
    // 本地开发时代理到 ESL Server 统一入口
    proxy: {
      '/api': 'http://localhost:3000'
    }
  }
});
