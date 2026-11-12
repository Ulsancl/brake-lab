import {defineConfig} from 'vite';
export default defineConfig({
  optimizeDeps:{entries:['index.html']},
  resolve:{dedupe:['three']},
  server:{host:'127.0.0.1',port:5195,strictPort:true,watch:{ignored:['**/.security-stage-*', '**/.security-stage-*/**', '**/output/**','**/release/**']}}
});
