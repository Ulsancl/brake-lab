import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';
import { checkTree, copyInput, publishDirectory, stagingDirectory } from './safe-files.mjs';

export async function buildWeb(root, { mode = 'production', destination = path.join(root, 'dist') } = {}) {
  const stage = stagingDirectory(root);
  const source = path.join(stage, 'web');
  const output = path.join(stage, 'bundle');
  try {
    for (const input of ['index.html', 'package.json', 'vite.config.js', 'src', 'shared', 'public']) {
      copyInput(root, path.join(root, input), path.join(source, input));
    }
    await build({ root: source, mode, build: { outDir: output, emptyOutDir: false } });
    checkTree(root, output);
    publishDirectory(root, output, destination);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  await buildWeb(path.dirname(import.meta.dirname));
}
