import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxy = { '/api': { target: env.BACKEND_URL || 'http://127.0.0.1:18085', changeOrigin: true } };
  return {
    plugins: [vue()],
    server: { host: '127.0.0.1', port: 18100, strictPort: true, proxy },
    preview: { host: '127.0.0.1', port: 18100, strictPort: true, proxy },
  };
});
