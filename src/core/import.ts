import type { Fixture, ImportError, ImportErrorCode, ImportResult } from './types';
import { isAscii1To32 } from './utf8';

const MIN_COUNT = 1;
const MAX_COUNT = 200_000;

const MIN_UNIVERSE = 1;
const MAX_UNIVERSE = 32_768;
const MIN_CHANNEL = 1;
const MAX_CHANNEL = 512;
/** start + footprint <= 513 保证闭区间末端 start + footprint - 1 <= 512。 */
const MAX_START_PLUS_FOOTPRINT = 513;

export function invalidPatch(code: ImportErrorCode, index: number): ImportResult {
  const error: ImportError = { display: 'INVALID_PATCH', code, index };
  return { ok: false, error };
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

/**
 * 解析并校验一份灯具 JSON 数组。
 *
 * 任何非法输入都返回 INVALID_PATCH；调用方必须保留旧补丁不变。
 * 校验通过的结果不保证几何上无冲突——冲突由核验算法报告，并非导入错误。
 */
export function parseFixtures(input: unknown): ImportResult {
  if (!Array.isArray(input)) {
    return invalidPatch('NOT_JSON_ARRAY', -1);
  }
  const n = input.length;
  if (n < MIN_COUNT || n > MAX_COUNT) {
    // 超上限的数组可能极大，先判定数量、不分配结果缓冲，直接拒绝。
    return invalidPatch('COUNT_OUT_OF_RANGE', n);
  }

  const fixtures = new Array<Fixture>(n);
  const seen = new Set<string>();

  for (let i = 0; i < n; i++) {
    const raw = input[i];
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return invalidPatch('MALFORMED_FIXTURE', i);
    }
    const r = raw as Record<string, unknown>;
    if (
      !('id' in r) ||
      !('universe' in r) ||
      !('start' in r) ||
      !('footprint' in r)
    ) {
      return invalidPatch('MALFORMED_FIXTURE', i);
    }
    const { id, universe, start, footprint } = r;

    if (!isAscii1To32(id)) {
      const code =
        typeof id === 'string' && /^[\x00-\x7F]*$/.test(id)
          ? 'ID_BAD_LENGTH'
          : 'ID_NOT_ASCII';
      return invalidPatch(code, i);
    }
    if (seen.has(id)) {
      return invalidPatch('ID_DUPLICATE', i);
    }
    seen.add(id);

    if (!isInt(universe) || universe < MIN_UNIVERSE || universe > MAX_UNIVERSE) {
      return invalidPatch('UNIVERSE_OUT_OF_RANGE', i);
    }
    if (!isInt(start) || start < MIN_CHANNEL || start > MAX_CHANNEL) {
      return invalidPatch('START_OUT_OF_RANGE', i);
    }
    if (!isInt(footprint) || footprint < MIN_CHANNEL || footprint > MAX_CHANNEL) {
      return invalidPatch('FOOTPRINT_OUT_OF_RANGE', i);
    }
    if (start + footprint >= MAX_START_PLUS_FOOTPRINT) {
      return invalidPatch('RANGE_OVERFLOW', i);
    }

    fixtures[i] = { id, universe, start, footprint };
  }

  return { ok: true, fixtures };
}
