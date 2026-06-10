import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      react: path.resolve(__dirname, './node_modules/react'),
      'react-dom': path.resolve(__dirname, './node_modules/react-dom'),
    },
  },
  // Tauri expects a fixed port, fail if it's already in use
  server: {
    port: 1420,
    strictPort: true,
  },
  optimizeDeps: {
    include: [
      'react-window',
    ],
    // 排除有问题的 es-toolkit，让 recharts 自己处理
    exclude: ['es-toolkit', 'es-toolkit/compat'],
  },
})
