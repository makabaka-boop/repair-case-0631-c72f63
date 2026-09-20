import type { ConflictGroup, Fixture, TrialResult } from './types';
import { compareAscii } from './utf8';

const MIN_UNIVERSE = 1;
const MAX_UNIVERSE = 32_768;
const MIN_CHANNEL = 1;
const MAX_CHANNEL = 512;
const MAX_START_PLUS_FOOTPRINT = 513;

/** 小顶堆：按区间 end 维护当前扫线位置仍覆盖到的灯具条目。 */
class EndHeap {
  private ends: number[] = [];
  private refs: number[] = [];

  get size(): number {
    return this.ends.length;
  }

  topRef(): number {
    return this.refs[0];
  }

  push(end: number, ref: number): void {
    const e = this.ends;
    const r = this.refs;
    let i = e.length;
    e.push(end);
    r.push(ref);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (e[p] <= e[i]) break;
      [e[p], e[i]] = [e[i], e[p]];
      [r[p], r[i]] = [r[i], r[p]];
      i = p;
    }
  }

  /** 弹出所有 end < start 的条目（闭区间：end === start-1 即不再相交）。 */
  prune(start: number): void {
    const e = this.ends;
    const r = this.refs;
    while (e.length > 0 && e[0] < start) {
      const lastE = e.pop()!;
      const lastR = r.pop()!;
      if (e.length === 0) break;
      e[0] = lastE;
      r[0] = lastR;
      let i = 0;
      const n = e.length;
      for (;;) {
        const l = 2 * i + 1;
        const rr = l + 1;
        let best = i;
        if (l < n && e[l] < e[best]) best = l;
        if (rr < n && e[rr] < e[best]) best = rr;
        if (best === i) break;
        [e[best], e[i]] = [e[i], e[best]];
        [r[best], r[i]] = [r[i], r[best]];
        i = best;
      }
    }
  }
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

/**
 * 单个 universe 内的分桶索引：
 * - buckets：每个起始通道一档，桶内按 end（footprint）降序排列
 * - starts：实际出现过的起始通道，升序，供二分定位
 * 通道总数仅 512，任何查询至多扫 512 个桶位。
 */
interface UniverseIndex {
  starts: number[];
  buckets: Map<number, Fixture[]>;
}

/**
 * 一份补丁的空间索引。一次构建可支撑任意次
 * O(512 + k) 的冲突查询（k 为命中数）。
 */
export class PatchIndex {
  private universes = new Map<number, UniverseIndex>();
  private byId = new Map<string, Fixture>();

  private constructor(fixtures: Fixture[]) {
    for (const f of fixtures) {
      this.byId.set(f.id, f);
      let u = this.universes.get(f.universe);
      if (!u) {
        u = { starts: [], buckets: new Map() };
        this.universes.set(f.universe, u);
      }
      let bucket = u.buckets.get(f.start);
      if (!bucket) {
        bucket = [];
        u.buckets.set(f.start, bucket);
      }
      bucket.push(f);
    }
    for (const u of this.universes.values()) {
      u.starts = [...u.buckets.keys()].sort((a, b) => a - b);
      for (const bucket of u.buckets.values()) {
        bucket.sort(
          (a, b) => b.footprint - a.footprint || compareAscii(a.id, b.id),
        );
      }
    }
  }

  static build(fixtures: Fixture[]): PatchIndex {
    return new PatchIndex(fixtures);
  }

  get size(): number {
    return this.byId.size;
  }

  getFixture(id: string): Fixture | undefined {
    return this.byId.get(id);
  }

  /** 升序通道列表中首个 >= target 的下标；无则返回 len。 */
  private static lowerBound(starts: number[], target: number): number {
    let lo = 0;
    let hi = starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * 查询给定闭区间 [start, start + footprint - 1] 在某 universe 内
   * 直接相交的灯具 id（可排除灯具自身），结果按 UTF-8 字节序排列。
   */
  conflictsAt(
    universe: number,
    start: number,
    footprint: number,
    excludeId: string | null,
  ): string[] {
    const u = this.universes.get(universe);
    if (!u) return [];
    const end = start + footprint - 1;
    const ids: string[] = [];
    const { starts, buckets } = u;
    const from = PatchIndex.lowerBound(starts, start);

    // start' >= 查询起点：只要 start' <= end，桶内每盏都相交。
    for (let i = from; i < starts.length && starts[i] <= end; i++) {
      for (const f of buckets.get(starts[i])!) {
        if (f.id !== excludeId) ids.push(f.id);
      }
    }
    // start' < 查询起点：候选 footprint <= 512，故只需回看 511 个通道；
    // 桶内按 end 降序，遇到第一盏 end < start 即可停止。
    const floor = start - (MAX_CHANNEL - 1);
    for (let i = from - 1; i >= 0 && starts[i] >= floor; i--) {
      for (const f of buckets.get(starts[i])!) {
        if (starts[i] + f.footprint - 1 < start) break;
        if (f.id !== excludeId) ids.push(f.id);
      }
    }

    ids.sort(compareAscii);
    return ids;
  }

  /**
   * 试移：不改补丁，分别给出原位与目标位的直接冲突 id。
   * footprint 沿用原灯具；目标 universe/start 非法时返回 INVALID_TARGET。
   */
  trial(id: string, universe: unknown, start: unknown): TrialResult {
    const f = this.byId.get(id);
    if (!f) {
      return { ok: false, display: 'INVALID_TARGET', code: 'UNKNOWN_FIXTURE' };
    }
    if (!isInt(universe) || universe < MIN_UNIVERSE || universe > MAX_UNIVERSE) {
      return {
        ok: false,
        display: 'INVALID_TARGET',
        code: 'INVALID_TARGET_UNIVERSE',
      };
    }
    if (
      !isInt(start) ||
      start < MIN_CHANNEL ||
      start > MAX_CHANNEL ||
      start + f.footprint > MAX_START_PLUS_FOOTPRINT
    ) {
      return {
        ok: false,
        display: 'INVALID_TARGET',
        code: 'INVALID_TARGET_START',
      };
    }

    const sourceConflicts = this.conflictsAt(
      f.universe,
      f.start,
      f.footprint,
      f.id,
    );
    const targetConflicts = this.conflictsAt(
      universe,
      start,
      f.footprint,
      f.id,
    );

    return {
      ok: true,
      id: f.id,
      universe: f.universe,
      start: f.start,
      footprint: f.footprint,
      sourceConflicts,
      targetConflicts,
      canCommit: targetConflicts.length === 0,
    };
  }

  /**
   * 提交试移：仅当目标位无冲突时生成新补丁，否则返回 null（补丁不变）。
   */
  commit(
    fixtures: Fixture[],
    id: string,
    universe: number,
    start: number,
  ): Fixture[] | null {
    const trial = this.trial(id, universe, start);
    if (!trial.ok || !trial.canCommit) return null;
    return fixtures.map((f) =>
      f.id === id ? { ...f, universe, start } : f,
    );
  }

  /**
   * 全网核验：把同 universe 闭区间相交关系的连通分量列为冲突组。
   *
   * 扫线 + 并查集：按 start 排序依次处理，小顶堆丢弃 end 已早于当前
   * start 的灯具；堆中剩余灯具都覆盖当前起点，彼此必已连通，
   * 故当前灯具只需与堆顶多盏合并即可。
   * 组按 (universe, 最小 start, 首 id) 排序，组内 id 按 UTF-8 字节序。
   */
  conflictGroups(): ConflictGroup[] {
    const groups: ConflictGroup[] = [];

    const universes = [...this.universes.keys()].sort((a, b) => a - b);
    for (const universe of universes) {
      const u = this.universes.get(universe)!;
      // 展平分桶为按 (start, id) 排序的数组（footprint 相同时桶内已按 id）。
      const arr: Fixture[] = [];
      for (const s of u.starts) {
        for (const f of u.buckets.get(s)!) arr.push(f);
      }
      arr.sort((a, b) => a.start - b.start || compareAscii(a.id, b.id));
      const n = arr.length;
      const parent = new Int32Array(n);
      for (let i = 0; i < n; i++) parent[i] = i;

      const find = (x: number): number => {
        let root = x;
        while (parent[root] !== root) root = parent[root];
        while (parent[x] !== x) {
          const next = parent[x];
          parent[x] = root;
          x = next;
        }
        return root;
      };
      const union = (a: number, b: number): void => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[rb] = ra;
      };

      const heap = new EndHeap();
      for (let i = 0; i < n; i++) {
        const f = arr[i];
        heap.prune(f.start);
        if (heap.size > 0) {
          union(i, heap.topRef());
        }
        heap.push(f.start + f.footprint - 1, i);
      }

      const comp = new Map<number, { minStart: number; ids: string[] }>();
      for (let i = 0; i < n; i++) {
        const root = find(i);
        let c = comp.get(root);
        if (!c) {
          c = { minStart: arr[i].start, ids: [] };
          comp.set(root, c);
        }
        c.ids.push(arr[i].id);
        if (arr[i].start < c.minStart) c.minStart = arr[i].start;
      }

      for (const c of comp.values()) {
        if (c.ids.length < 2) continue; // 单独成组表示无冲突，不列出
        c.ids.sort(compareAscii);
        groups.push({ universe, minStart: c.minStart, ids: c.ids });
      }
    }

    groups.sort(
      (a, b) =>
        a.universe - b.universe ||
        a.minStart - b.minStart ||
        compareAscii(a.ids[0], b.ids[0]),
    );
    return groups;
  }
}
