import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Tauri expects a fixed port, fail if it's already in use
  server: {
    port: 1420,
    strictPort: true,
  },
  optimizeDeps: {
    include: ['react-window'],
  },
})
