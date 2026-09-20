/**
 * 灯具补丁的核心数据类型。
 *
 * 契约（见 README）：
 * - id：1–32 位 ASCII 字符串，全库唯一
 * - universe：1–32768
 * - start、footprint：1–512，且 start + footprint <= 513
 *   （灯具占用闭区间 [start, start + footprint - 1]，end 最大为 512）
 */
export interface Fixture {
  id: string;
  universe: number;
  start: number;
  footprint: number;
}

/** 同 universe 内闭区间相交关系形成的一个连通分量。 */
export interface ConflictGroup {
  universe: number;
  /** 组内最小 start。 */
  minStart: number;
  /** 组内 id，按 UTF-8 字节序升序。 */
  ids: string[];
}

export type ImportErrorCode =
  | 'NOT_JSON_ARRAY'
  | 'COUNT_OUT_OF_RANGE'
  | 'MALFORMED_FIXTURE'
  | 'ID_NOT_ASCII'
  | 'ID_BAD_LENGTH'
  | 'ID_DUPLICATE'
  | 'UNIVERSE_OUT_OF_RANGE'
  | 'START_OUT_OF_RANGE'
  | 'FOOTPRINT_OUT_OF_RANGE'
  | 'RANGE_OVERFLOW';

export interface ImportError {
  /** 任何非法输入统一以 INVALID_PATCH 呈现给操作员；code 供界面给出细节。 */
  display: 'INVALID_PATCH';
  code: ImportErrorCode;
  /** 触发错误的数组下标（结构错误时为 -1）。 */
  index: number;
}

export type ImportResult =
  | { ok: true; fixtures: Fixture[] }
  | { ok: false; error: ImportError };

export type TrialErrorCode =
  | 'UNKNOWN_FIXTURE'
  | 'INVALID_TARGET_UNIVERSE'
  | 'INVALID_TARGET_START';

export type TrialResult =
  | {
      ok: true;
      id: string;
      universe: number;
      start: number;
      footprint: number;
      /** 保持原位时，与该灯具闭区间相交的其他灯具 id（UTF-8 字节序）。 */
      sourceConflicts: string[];
      /** 移到目标位后，与目标区间相交的灯具 id（不含灯具自身，UTF-8 字节序）。 */
      targetConflicts: string[];
      /** 目标位 footprint 沿用原 footprint，故不会超界；目标列表为空时可提交。 */
      canCommit: boolean;
    }
  | { ok: false; display: 'INVALID_TARGET'; code: TrialErrorCode };
