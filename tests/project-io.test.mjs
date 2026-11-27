import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readBoundedFile, replaceProjectFile } from '../desktop/project-io.cjs';
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
  const target = path.join(directory, 'project.json');
  const occupied = path.join(directory, '.brake-save-occupied.tmp');
  await fs.writeFile(target, 'saved');
  await fs.writeFile(occupied, 'unrelated');
  await assert.rejects(replaceProjectFile(target, 'new', () => 'occupied'), { code: 'EEXIST' });
  assert.equal(await fs.readFile(occupied, 'utf8'), 'unrelated');
  assert.equal(await fs.readFile(target, 'utf8'), 'saved');
  const blocked = path.join(directory, 'directory.json');
  await fs.mkdir(blocked);
  await assert.rejects(replaceProjectFile(blocked, '{}', () => 'rejected'));
  assert.deepEqual((await fs.readdir(directory)).sort(), ['.brake-save-occupied.tmp', 'directory.json', 'project.json']);
  await replaceProjectFile(target, 'new', () => 'fresh');
  assert.equal(await fs.readFile(target, 'utf8'), 'new');
});
