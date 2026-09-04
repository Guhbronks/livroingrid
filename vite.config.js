import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        dashvaso: resolve(import.meta.dirname, 'dashvaso.html'),
        rastreio: resolve(import.meta.dirname, 'rastreio.html')
      }
    }
  }
});
