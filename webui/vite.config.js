import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  base: './',
  build: {
    outDir: '../../module/webroot',
    emptyOutDir: true,
    assetsDir: 'assets'
  }
});
