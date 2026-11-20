import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('leaflet') || id.includes('react-leaflet')) return 'map-vendor';
          if (id.includes('recharts') || id.includes('/d3-')) return 'chart-vendor';
          if (id.includes('react') || id.includes('scheduler')) return 'react-vendor';
        }
      }
    }
  }
});