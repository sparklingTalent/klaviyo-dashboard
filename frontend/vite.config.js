import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'inject-api-base',
      transformIndexHtml: {
        enforce: 'pre',
        transform(html) {
          const apiBase = process.env.VITE_API_BASE_URL || '/api';
          const scriptTag = `<script>window.__API_BASE__ = ${JSON.stringify(apiBase)};</script>`;
          return html.replace('</head>', `${scriptTag}\n</head>`);
        }
      }
    }
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE_URL || 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  }
});
