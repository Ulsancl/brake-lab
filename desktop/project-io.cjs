const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function readBoundedFile(file, limit, message, { open = fsp.open, local = false } = {}) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0) | (local ? fs.constants.O_NOFOLLOW || 0 : 0);
  if (local && (await fsp.lstat(file)).isSymbolicLink()) throw new Error(message);
  const handle = await open(file, flags);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error(message);
    // Grow the buffer only as the file grows. The probe byte detects growth
    // even on an open handle whose original size was within the limit.
    const data = Buffer.allocUnsafe(stat.size);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await handle.read(data, offset, data.length - offset, null);
      if (!bytesRead) return data.subarray(0, offset);
      offset += bytesRead;
    }
    const chunks = [data];
    while (offset <= limit) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, limit + 1 - offset));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) return chunks.length === 1 ? data : Buffer.concat(chunks, offset);
      offset += bytesRead;
      chunks.push(chunk.subarray(0, bytesRead));
    }
    throw new Error(message);
  } finally { await handle.close(); }
}

async function replaceProjectFile(target, contents, createId = randomUUID) {
  const temporary = path.join(path.dirname(target), `.brake-save-${createId()}.tmp`);
  // A failed exclusive open confers no ownership of the path.
  const handle = await fsp.open(temporary, 'wx', 0o600);
  let published = false;
  try {
    try { await handle.writeFile(contents, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await fsp.rename(temporary, target);
    published = true;
  } finally {
    if (!published) await fsp.unlink(temporary).catch(() => {});
  }
}

module.exports = { readBoundedFile, replaceProjectFile };
