export const MAX_PROJECT_BYTES = 10 * 1024 * 1024;

export function decodeProjectBytes(bytes) {
  if (bytes.byteLength > MAX_PROJECT_BYTES) throw new Error('실험 파일은 10 MiB 이하여야 합니다.');
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error('UTF-8 JSON 실험 파일을 읽을 수 없습니다. 원본 파일은 변경하지 않습니다.');
  }
}

// Both 501-sample runs plus settings and summaries fit within these limits.
// Count only structural punctuation outside strings, before allocating objects.
export function fitsProjectStructure(text) {
  let inString = false, depth = 0, tokens = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (inString) {
      if (ch === 92) i++; // Escaped character
      else if (ch === 34) inString = false;
    } else if (ch === 34) inString = true;
    else if (ch === 91 || ch === 123) {
      if (++depth > 16 || ++tokens > 150_000) return false;
    } else if (ch === 93 || ch === 125) {
      if (--depth < 0) return false;
    } else if ((ch === 44 || ch === 58) && ++tokens > 150_000) return false;
  }
  return true;
}
