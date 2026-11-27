import { defineConfig, normalizePath } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const rootPath = normalizePath(fileURLToPath(new URL('.', import.meta.url)));
const generatedPaths = ['.security-stage-*', 'output', 'release', 'dist'].map(directory => rootPath + directory + '/**');
const csp = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
export default defineConfig({
  base: './',
  plugins: [{
    name: 'brake-lab-html',
    transformIndexHtml(html, context) {
      const versioned = html.replace('__BRAKE_LAB_VERSION__', version);
      if (context.server) return versioned;
      return { html: versioned, tags: [{ tag: 'meta', attrs: {
        'http-equiv': 'Content-Security-Policy', content: csp,
      }, injectTo: 'head-prepend' }] };
    },
  }],
  worker: { format: 'es' },
  optimizeDeps:{entries:['index.html']},
  resolve:{dedupe:['three']},
  server: {
    host: '127.0.0.1', port: 5195, strictPort: true,
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**',
      ...generatedPaths] },
    watch: { ignored: ['**/.security-stage-*', '**/.security-stage-*/**', '**/output/**', '**/release/**', '**/dist/**'] },
  },
});
