/**
 * UTF-8 字节序工具。
 *
 * 合法补丁中 id 全为 ASCII（码位 0x00–0x7F），此时 UTF-8 字节序与
 * JS 字符串的 UTF-16 码元序完全一致；toUtf8Bytes 仍按标准 UTF-8 编码，
 * 以便对任意字符串（含校验失败、非 ASCII）得到确定的字节序。
 */

const encoder = new TextEncoder();

/** 是否全部由 1–32 位可打印/任意 ASCII 码元（0x00–0x7F）组成。 */
export function isAscii1To32(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length >= 1 &&
    id.length <= 32 &&
    // eslint-disable-next-line no-control-regex
    /^[\x00-\x7F]+$/.test(id)
  );
}

export function toUtf8Bytes(s: string): Uint8Array {
  return encoder.encode(s);
}

/** 按 UTF-8 字节序比较两个字符串（字典序，短序列为前缀时小者在前）。 */
export function compareUtf8(a: string, b: string): number {
  const ba = toUtf8Bytes(a);
  const bb = toUtf8Bytes(b);
  const n = Math.min(ba.length, bb.length);
  for (let i = 0; i < n; i++) {
    if (ba[i] !== bb[i]) return ba[i] - bb[i];
  }
  return ba.length - bb.length;
}

/**
 * 已知全部为 ASCII 时的比较：UTF-16 码元序即 UTF-8 字节序，
 * 热路径（20 万级排序、查询结果排序）避免重复编码。
 */
export function compareAscii(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
