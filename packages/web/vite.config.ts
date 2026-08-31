import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  // 静态产物统一挂在 /admin 路径下，由 Nginx 托管
  base: '/admin/',
  plugins: [vue()],
  // dist 被 docker 只读挂载进 nginx 容器：原地覆盖文件而不删除重建目录，
  // 避免目录 inode 变化导致容器挂载指向旧目录、重建后必须 up -d 重挂
  build: {
    emptyOutDir: false
  },
  server: {
    // 本地开发时代理到 ESL Server 统一入口
    proxy: {
      '/api': 'http://localhost:3000'
    }
  }
});
