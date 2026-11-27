import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { readBoundedFile, replaceProjectFile } from '../desktop/project-io.cjs';
import { windowsPowerShell, windowsPowerShellEnv } from '../desktop/windows-save.cjs';
import { decodeProjectBytes } from '../shared/project-limits.js';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'brake-project-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('bounded reader accepts the exact byte limit and closes the same handle after a growing file', async t => {
  const file = path.join(await fixture(t), 'fixture.txt');
  await fs.writeFile(file, '12345678');
  assert.equal((await readBoundedFile(file, 8, 'read limit')).toString(), '12345678');
  let requested = 0, closed = false;
  const open = async (...args) => {
    const handle = await fs.open(...args);
    return {
      async stat() {
        const initial = await handle.stat();
        await fs.appendFile(file, '90');
        return initial;
      },
      read(buffer, offset, count, position) {
        requested += count;
        return handle.read(buffer, offset, count, position);
      },
      async close() { await handle.close(); closed = true; },
    };
  };
  await assert.rejects(readBoundedFile(file, 8, 'read limit', { open }), /read limit/);
  assert.equal(requested, 9);
  assert.equal(closed, true);
});

test('native UTF-8 decoding keeps the BOM and rejects malformed input', () => {
  assert.equal(decodeProjectBytes(Buffer.from('\uFEFF브레이크')), '\uFEFF브레이크');
  assert.throws(() => decodeProjectBytes(Buffer.from([0xff])), /UTF-8/);
});

test('exclusive save keeps preexisting temporary files and cleans up its own on a failed rename', async t => {
  const directory = await fixture(t);
  const portableSave = (target, contents, id) => replaceProjectFile(target, contents, {
    platform: 'linux', createId: () => id,
  });
  const target = path.join(directory, 'project.json');
  const occupied = path.join(directory, '.brake-save-occupied.tmp');
  await fs.writeFile(target, 'saved');
  await fs.writeFile(occupied, 'unrelated');
  await assert.rejects(portableSave(target, 'new', 'occupied'), { code: 'EEXIST' });
  assert.equal(await fs.readFile(occupied, 'utf8'), 'unrelated');
  assert.equal(await fs.readFile(target, 'utf8'), 'saved');
  const blocked = path.join(directory, 'directory.json');
  await fs.mkdir(blocked);
  await assert.rejects(portableSave(blocked, '{}', 'rejected'));
  assert.deepEqual((await fs.readdir(directory)).sort(), ['.brake-save-occupied.tmp', 'directory.json', 'project.json']);
  await portableSave(target, 'new', 'fresh');
  assert.equal(await fs.readFile(target, 'utf8'), 'new');
});

test('Windows saves preserve a file-specific DACL and create private new projects', {
  skip: process.platform !== 'win32' && 'Windows ACLs require Windows',
}, async t => {
  const directory = await fixture(t);
  const target = path.join(directory, '기존 실험.brake.json');
  const newTarget = path.join(directory, '새 실험.brake.json');
  const runPowerShell = script => {
    const command = Buffer.from("$ErrorActionPreference = 'Stop'\n" + script, 'utf16le').toString('base64');
    const result = spawnSync(windowsPowerShell(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', command], {
      encoding: 'utf8', env: windowsPowerShellEnv({ BRAKE_ACL_TARGET: target, BRAKE_ACL_NEW: newTarget }),
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return result.stdout.trim();
  };

  await fs.writeFile(target, '{"project":"기존 기록"}');
  const before = runPowerShell(`
    $user = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $other = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    if ($user -eq $other) { $other = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544') }
    $acl = [Security.AccessControl.FileSecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($user, 'FullControl', 'Allow'))
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($other, 'Read', 'Allow'))
    [IO.File]::SetAccessControl($env:BRAKE_ACL_TARGET, $acl)
    [IO.File]::GetAccessControl($env:BRAKE_ACL_TARGET).GetSecurityDescriptorSddlForm('Access')
  `);
  assert.match(before, /^D:P/);
  const contents = '{"project":"보관할 실험"}';
  await replaceProjectFile(target, contents);
  await replaceProjectFile(newTarget, contents);
  assert.equal(await fs.readFile(target, 'utf8'), contents);
  assert.equal(await fs.readFile(newTarget, 'utf8'), contents);
  const after = runPowerShell("[IO.File]::GetAccessControl($env:BRAKE_ACL_TARGET).GetSecurityDescriptorSddlForm('Access')");
  assert.equal(after, before);
  assert.equal(runPowerShell(`
    $acl = [IO.File]::GetAccessControl($env:BRAKE_ACL_NEW)
    $rules = $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
    $user = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl.AreAccessRulesProtected -and $rules.Count -eq 1 -and $rules[0].IdentityReference -eq $user
  `), 'True');
  assert.deepEqual((await fs.readdir(directory)).sort(), ['기존 실험.brake.json', '새 실험.brake.json']);
});

test('a Windows save to a directory reports a friendly error and removes its stage', {
  skip: process.platform !== 'win32' && 'Windows save helper requires Windows',
}, async t => {
  const directory = await fixture(t);
  const target = path.join(directory, 'folder.brake.json');
  await fs.mkdir(target);
  const marker = path.join(target, 'marker.txt');
  await fs.writeFile(marker, 'untouched fixture');
  await assert.rejects(replaceProjectFile(target, '{}'), /폴더와 파일의 권한/);
  assert.equal(await fs.readFile(marker, 'utf8'), 'untouched fixture');
  assert.deepEqual(await fs.readdir(directory), ['folder.brake.json']);
});
