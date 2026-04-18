import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/appearance-ranking-and-lookalike/',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('face-api.js') || id.includes('@tensorflow') || id.includes('tfjs')) {
            return 'face-runtime'
          }
          if (id.includes('chart.js') || id.includes('react-chartjs-2')) {
            return 'charts'
          }
        },
      },
    },
  },
})
