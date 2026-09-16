import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const API_TARGET = process.env.SCHEDULE_API_TARGET ?? 'http://localhost:8787'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 前端只调用自家接口，识别凭证始终留在服务端。
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
})
