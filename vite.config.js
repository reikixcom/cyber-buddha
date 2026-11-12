import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5178,
    strictPort: true
  },
  preview: {
    host: '0.0.0.0',
    port: 4178,
    strictPort: true
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200
  }
})
