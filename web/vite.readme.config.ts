import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 临时配置：README 素材录制用（5174 → 隔离实例 18080），用完即删
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:18080',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
})
