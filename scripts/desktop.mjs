import { checkedPath, readInput, copyInput, stagingDirectory, publishDirectory, writeArtifact, checkTree } from './safe-files.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildWeb } from './build-web.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
if (!['start', 'package', 'package-release', 'prepare-test', 'package-test'].includes(mode)) {
  throw new Error('Use start, package, package-release, prepare-test or package-test');
}
const signed = mode === 'package-release', testing = ['prepare-test', 'package-test'].includes(mode);
if (signed && (process.platform !== 'win32' || /^pull_request/.test(process.env.GITHUB_EVENT_NAME || '')
  || !/^[a-f0-9]{64}$/i.test(process.env.BRAKE_RELEASE_SIGNER_SHA256 || ''))) {
  throw new Error('Signed packaging requires trusted Windows release execution and BRAKE_RELEASE_SIGNER_SHA256');
}
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
delete env.CSC_FOR_PULL_REQUEST;
if (!signed) {
  env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  for (const key of ['CSC_LINK', 'WIN_CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_KEY_PASSWORD']) delete env[key];
}
function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Process exited with code ${code}`)));
  });
}
checkTree(root, path.join(root, 'node_modules', 'electron'));
const electronPackage = path.dirname(require.resolve('electron/package.json'));
await run(process.execPath, [path.join(electronPackage, 'install.js')]);
if (mode === 'start') {
  await buildWeb(root);
  await run(require('electron'), [root]);
} else {
  const stage = stagingDirectory(root), app = path.join(stage, 'app'), output = path.join(stage, 'windows');
  try {
    const configuration = JSON.parse(readInput(root, path.join(root, 'electron-builder.json')));
    const packageInfo = JSON.parse(readInput(root, path.join(root, 'package.json')));
    const inputs = [...new Set(['desktop', 'shared/project-limits.js',
      ...configuration.extraResources.map(item => item.from)])];
    for (const input of inputs.filter(file => !inputs.some(parent => file !== parent && file.startsWith(parent + '/')))) {
      copyInput(root, path.join(root, input), path.join(app, input));
    }
    await buildWeb(root, { mode: testing ? 'test' : 'production', destination: path.join(app, 'dist') });
    if (testing) {
      packageInfo.main = 'desktop/test-entry.cjs';
      copyInput(root, path.join(root, 'tests', 'fixtures', 'desktop-test-entry.cjs'), path.join(app, packageInfo.main));
    }
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify(packageInfo), { flag: 'wx' });
    if (mode === 'prepare-test') {
      publishDirectory(root, app, path.join(root, 'output', 'desktop-source-app'));
    } else {
      await packageApp(configuration, packageInfo, app, output, stage);
    }
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

async function packageApp(configuration, packageInfo, app, output, stage) {
    for (const dependency of Object.keys(packageInfo.dependencies || {})) {
      copyInput(root, path.join(root, 'node_modules', dependency), path.join(app, 'node_modules', dependency));
    }
    const electronDist = checkedPath(root, path.join(root, 'node_modules', 'electron', 'dist'));
    checkTree(root, electronDist);
    const configFile = path.join(stage, 'electron-builder.json');
    if (signed) configuration.forceCodeSigning = true;
    fs.writeFileSync(configFile, JSON.stringify(configuration), { flag: 'wx' });
    await run(process.execPath, [path.join(path.dirname(require.resolve('electron-builder/package.json')), 'cli.js'),
      '--win', testing ? '--dir' : 'nsis', '--x64', '--config', configFile, '--projectDir', app,
      `--config.electronDist=${electronDist}`, `--config.directories.output=${output}`, '--config.npmRebuild=false', '--publish', 'never']);
    if (testing) {
      publishDirectory(root, output, path.join(root, 'output', 'desktop-test-app'));
      return;
    }
    const name = `Brake-Lab-Setup-${packageInfo.version}.exe`;
    const file = path.join(output, name);
    if (signed) {
      const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const verifier = checkedPath(root, path.join(root, 'scripts', 'verify-authenticode.ps1'));
      for (const executable of [file, path.join(output, 'win-unpacked', 'Brake Lab.exe')]) {
        await run(powershell, ['-NoProfile', '-NonInteractive', '-File', verifier, '-Path', checkedPath(root, executable)]);
      }
    }
    writeArtifact(root, file + '.sha256', `${createHash('sha256').update(readInput(root, file)).digest('hex')}  ${name}\n`);
    const destination = path.join(root, 'release', signed ? 'signed-windows' : 'windows');
    publishDirectory(root, output, destination);
    console.log(`Installer: ${path.join(destination, name)}`);
}
