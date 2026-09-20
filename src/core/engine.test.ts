import { describe, expect, it } from 'vitest';
import { PatchIndex } from './engine';
import { parseFixtures } from './import';
import type { ConflictGroup, Fixture } from './types';
import { compareUtf8 } from './utf8';

/* ------------------------------------------------------------------ */
/* 构造工具：所有夹具都经过 parseFixtures 校验后使用                     */
/* ------------------------------------------------------------------ */

interface Raw {
  id: string;
  universe?: number;
  start?: number;
  footprint?: number;
}

function valid(raw: Raw[]): Fixture[] {
  const r = parseFixtures(raw);
  if (!r.ok) throw new Error(`fixture setup invalid: ${r.error.code}`);
  return r.fixtures;
}

/* ------------------------------------------------------------------ */
/* 朴素两两预言机：O(n²) 枚举相交对，DFS 求连通分量                      */
/* ------------------------------------------------------------------ */

function overlaps(a: Fixture, b: Fixture): boolean {
  return (
    a.universe === b.universe &&
    !(a.start + a.footprint - 1 < b.start) &&
    !(b.start + b.footprint - 1 < a.start)
  );
}

function oracleGroups(fixtures: Fixture[]): ConflictGroup[] {
  const n = fixtures.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (overlaps(fixtures[i], fixtures[j])) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }
  const seen = new Array<boolean>(n).fill(false);
  const groups: ConflictGroup[] = [];
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    const stack = [s];
    const comp: number[] = [];
    seen[s] = true;
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      for (const j of adj[i]) {
        if (!seen[j]) {
          seen[j] = true;
          stack.push(j);
        }
      }
    }
    if (comp.length < 2) continue;
    const ids = comp.map((i) => fixtures[i].id).sort(compareUtf8);
    groups.push({
      universe: fixtures[s].universe,
      minStart: Math.min(...comp.map((i) => fixtures[i].start)),
      ids,
    });
  }
  groups.sort(
    (a, b) =>
      a.universe - b.universe ||
      a.minStart - b.minStart ||
      compareUtf8(a.ids[0], b.ids[0]),
  );
  return groups;
}

function oracleConflicts(
  fixtures: Fixture[],
  self: Fixture,
  universe: number,
  start: number,
): string[] {
  const probe: Fixture = {
    id: self.id,
    universe,
    start,
    footprint: self.footprint,
  };
  return fixtures
    .filter((f) => f.id !== self.id && overlaps(f, probe))
    .map((f) => f.id)
    .sort(compareUtf8);
}

function expectGroupsMatch(fixtures: Fixture[]): PatchIndex {
  const index = PatchIndex.build(fixtures);
  expect(index.conflictGroups()).toEqual(oracleGroups(fixtures));
  return index;
}

/* ------------------------------------------------------------------ */
/* 导入校验                                                             */
/* ------------------------------------------------------------------ */

describe('parseFixtures 校验契约', () => {
  it('1 项合法数据可导入', () => {
    const r = parseFixtures([{ id: 'a', universe: 1, start: 1, footprint: 512 }]);
    expect(r.ok).toBe(true);
  });

  it('非法 JSON（非数组）报 INVALID_PATCH / NOT_JSON_ARRAY', () => {
    const r = parseFixtures({ not: 'array' });
    expect(r).toMatchObject({
      ok: false,
      error: { display: 'INVALID_PATCH', code: 'NOT_JSON_ARRAY' },
    });
  });

  it.each([
    { label: '空数组', v: [], code: 'COUNT_OUT_OF_RANGE' },
    {
      label: '非 ASCII id',
      v: [{ id: '灯灯', universe: 1, start: 1, footprint: 1 }],
      code: 'ID_NOT_ASCII',
    },
    {
      label: '33 位 id',
      v: [{ id: 'x'.repeat(33), universe: 1, start: 1, footprint: 1 }],
      code: 'ID_BAD_LENGTH',
    },
    {
      label: '空 id',
      v: [{ id: '', universe: 1, start: 1, footprint: 1 }],
      code: 'ID_BAD_LENGTH',
    },
    {
      label: '重复 id',
      v: [
        { id: 'a', universe: 1, start: 1, footprint: 1 },
        { id: 'a', universe: 2, start: 1, footprint: 1 },
      ],
      code: 'ID_DUPLICATE',
    },
    {
      label: 'universe 为 0',
      v: [{ id: 'a', universe: 0, start: 1, footprint: 1 }],
      code: 'UNIVERSE_OUT_OF_RANGE',
    },
    {
      label: 'universe 超 32768',
      v: [{ id: 'a', universe: 32769, start: 1, footprint: 1 }],
      code: 'UNIVERSE_OUT_OF_RANGE',
    },
    {
      label: 'start 为 513',
      v: [{ id: 'a', universe: 1, start: 513, footprint: 1 }],
      code: 'START_OUT_OF_RANGE',
    },
    {
      label: 'footprint 为 0',
      v: [{ id: 'a', universe: 1, start: 1, footprint: 0 }],
      code: 'FOOTPRINT_OUT_OF_RANGE',
    },
    {
      label: 'start + footprint = 514',
      v: [{ id: 'a', universe: 1, start: 2, footprint: 512 }],
      code: 'RANGE_OVERFLOW',
    },
    {
      label: '缺字段',
      v: [{ id: 'a', universe: 1, start: 1 }],
      code: 'MALFORMED_FIXTURE',
    },
    {
      label: '非整数',
      v: [{ id: 'a', universe: 1.5, start: 1, footprint: 1 }],
      code: 'UNIVERSE_OUT_OF_RANGE',
    },
  ])('$label 被拒绝', ({ v, code }) => {
    const r = parseFixtures(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.display).toBe('INVALID_PATCH');
      expect(r.error.code).toBe(code);
    }
  });

  it('超过 200000 项报 COUNT_OUT_OF_RANGE', () => {
    const big = Array.from({ length: 200_001 }, (_, i) => ({
      id: `f${i}`,
      universe: 1,
      start: 1,
      footprint: 1,
    }));
    const r = parseFixtures(big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('COUNT_OUT_OF_RANGE');
  });
});

/* ------------------------------------------------------------------ */
/* 端点相接：闭区间共享通道即冲突，恰好相邻不冲突                         */
/* ------------------------------------------------------------------ */

describe('端点相接语义', () => {
  it('footprint=1 相邻通道 [1] 与 [2] 不冲突', () => {
    const fx = valid([
      { id: 'A', universe: 1, start: 1, footprint: 1 },
      { id: 'B', universe: 1, start: 2, footprint: 1 },
    ]);
    expectGroupsMatch(fx);
    expect(PatchIndex.build(fx).conflictGroups()).toEqual([]);
  });

  it('闭区间端点共享通道即冲突：[1,2] 与 [2,2]', () => {
    const fx = valid([
      { id: 'A', universe: 1, start: 1, footprint: 2 },
      { id: 'B', universe: 1, start: 2, footprint: 1 },
    ]);
    expect(PatchIndex.build(fx).conflictGroups()).toEqual([
      { universe: 1, minStart: 1, ids: ['A', 'B'] },
    ]);
  });

  it('不同 universe 即使区间完全重合也不冲突', () => {
    const fx = valid([
      { id: 'A', universe: 1, start: 1, footprint: 10 },
      { id: 'B', universe: 2, start: 1, footprint: 10 },
    ]);
    expect(PatchIndex.build(fx).conflictGroups()).toEqual([]);
  });

  it('端点相接把一长串灯具连成一个连通分量', () => {
    const fx = valid(
      [1, 2, 3, 4, 5].map((s) => ({
        id: `L${s}`,
        universe: 7,
        start: s,
        footprint: 2, // [s, s+1]，与下一盏在 s+1 相接
      })),
    );
    expectGroupsMatch(fx);
  });
});

/* ------------------------------------------------------------------ */
/* 嵌套                                                                 */
/* ------------------------------------------------------------------ */

describe('嵌套区间', () => {
  it('大区间内含两盏互不接触的小灯，三者同组', () => {
    const fx = valid([
      { id: 'BIG', universe: 3, start: 1, footprint: 100 },
      { id: 's1', universe: 3, start: 10, footprint: 1 },
      { id: 's2', universe: 3, start: 90, footprint: 1 },
    ]);
    const groups = PatchIndex.build(fx).conflictGroups();
    expect(groups).toEqual([
      { universe: 3, minStart: 1, ids: ['BIG', 's1', 's2'] },
    ]);
    expectGroupsMatch(fx);
  });

  it('多层嵌套与跨 universe 混合仍与预言机一致', () => {
    const fx = valid([
      { id: 'a', universe: 1, start: 1, footprint: 512 },
      { id: 'b', universe: 1, start: 2, footprint: 400 },
      { id: 'c', universe: 1, start: 100, footprint: 10 },
      { id: 'd', universe: 1, start: 300, footprint: 5 },
      { id: 'e', universe: 2, start: 1, footprint: 512 },
      { id: 'f', universe: 2, start: 512, footprint: 1 },
    ]);
    expectGroupsMatch(fx);
  });
});

/* ------------------------------------------------------------------ */
/* 组排序：universe、最小 start、首 id；组内 UTF-8 字节序                */
/* ------------------------------------------------------------------ */

describe('排序契约', () => {
  it('组内 id 按 UTF-8 字节序（大写先于小写）', () => {
    const fx = valid([
      { id: 'apple', universe: 1, start: 10, footprint: 2 },
      { id: 'Zebra', universe: 1, start: 10, footprint: 2 },
      { id: 'aa', universe: 1, start: 10, footprint: 2 },
    ]);
    const [g] = PatchIndex.build(fx).conflictGroups();
    expect(g.ids).toEqual(['Zebra', 'aa', 'apple']);
  });

  it('组按 universe、最小 start、首 id 排序', () => {
    const fx = valid([
      { id: 'u2', universe: 2, start: 1, footprint: 2 },
      { id: 'u2b', universe: 2, start: 1, footprint: 2 },
      { id: 'later', universe: 1, start: 50, footprint: 2 },
      { id: 'late2', universe: 1, start: 50, footprint: 2 },
      { id: 'early', universe: 1, start: 10, footprint: 2 },
      { id: 'earl2', universe: 1, start: 10, footprint: 2 },
      { id: '100u', universe: 10, start: 1, footprint: 2 },
      { id: '100b', universe: 10, start: 1, footprint: 2 },
    ]);
    expectGroupsMatch(fx);
    const groups = PatchIndex.build(fx).conflictGroups();
    expect(groups.map((g) => [g.universe, g.minStart, g.ids[0]])).toEqual([
      [1, 10, 'earl2'],
      [1, 50, 'late2'],
      [2, 1, 'u2'],
      [10, 1, '100b'],
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* 试移、提交、组拆分                                                    */
/* ------------------------------------------------------------------ */

describe('试移与提交', () => {
  // 链：s2 嵌套在 A 内；A=[1,3] 与 B=[3,5] 共通道 3；
  // B 与 C=[5,7] 共通道 5；c2 嵌套在 C 内。
  // 全组：{s2, A, B, C, c2}
  function chain(): Fixture[] {
    return valid([
      { id: 'A', universe: 1, start: 1, footprint: 3 },
      { id: 's2', universe: 1, start: 2, footprint: 1 },
      { id: 'B', universe: 1, start: 3, footprint: 3 },
      { id: 'C', universe: 1, start: 5, footprint: 3 },
      { id: 'c2', universe: 1, start: 6, footprint: 1 },
    ]);
  }

  it('试移列出原位直接冲突，只算直接相交（不传递）', () => {
    const fx = chain();
    const index = PatchIndex.build(fx);
    const t = index.trial('B', 9, 100);
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    // B=[3,5]：直接碰到 A（通道3）与 C（通道5）；s2、c2 不直接碰 B
    expect(t.sourceConflicts).toEqual(['A', 'C']);
    expect(t.sourceConflicts).toEqual(
      oracleConflicts(fx, fx.find((f) => f.id === 'B')!, 1, 3),
    );
    expect(t.targetConflicts).toEqual([]);
    expect(t.canCommit).toBe(true);
  });

  it('目标位有阻挡：canCommit=false，提交后补丁不变、阻挡灯具可见', () => {
    const fx = chain();
    const index = PatchIndex.build(fx);
    const t = index.trial('B', 1, 1); // 目标 [1,3] 与 A、s2 冲突
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.targetConflicts).toEqual(['A', 's2']);
    expect(t.canCommit).toBe(false);

    const next = index.commit(fx, 'B', 1, 1);
    expect(next).toBeNull();
    // 原地址保留：B 仍在原位，核验结果不变
    expect(PatchIndex.build(fx).conflictGroups()).toEqual(oracleGroups(fx));
  });

  it('移走桥接灯具后冲突组拆分为两个独立组', () => {
    const fx = chain();
    const index = PatchIndex.build(fx);
    expect(index.conflictGroups()).toHaveLength(1);

    const next = index.commit(fx, 'B', 1, 400); // [400,402] 无人占用
    expect(next).not.toBeNull();
    if (next === null) return;

    const groups = PatchIndex.build(next).conflictGroups();
    expect(groups).toEqual(oracleGroups(next));
    // {s2,A} 与 {C,c2} 两组，桥接被拆开
    expect(groups).toHaveLength(2);
    expect(groups[0].ids).toEqual(['A', 's2']);
    expect(groups[1].ids).toEqual(['C', 'c2']);

    // B 已在新地址，无冲突
    const t2 = PatchIndex.build(next!).trial('B', 1, 400);
    if (t2.ok) {
      expect(t2.sourceConflicts).toEqual([]);
      expect(t2.targetConflicts).toEqual([]);
    }
  });

  it('非法试移目标被拒绝', () => {
    const fx = chain();
    const index = PatchIndex.build(fx);
    expect(index.trial('B', 0, 1)).toMatchObject({
      ok: false,
      code: 'INVALID_TARGET_UNIVERSE',
    });
    expect(index.trial('B', 32769, 1)).toMatchObject({
      ok: false,
      code: 'INVALID_TARGET_UNIVERSE',
    });
    expect(index.trial('B', 1, 513)).toMatchObject({
      ok: false,
      code: 'INVALID_TARGET_START',
    });
    // footprint 3，start 511 -> [511,513] 超界
    expect(index.trial('B', 1, 511)).toMatchObject({
      ok: false,
      code: 'INVALID_TARGET_START',
    });
    expect(index.trial('GHOST', 1, 1)).toMatchObject({
      ok: false,
      code: 'UNKNOWN_FIXTURE',
    });
  });

  it('非法导入保留旧补丁', () => {
    const fx = chain();
    const index = PatchIndex.build(fx);
    const before = index.conflictGroups();
    const bad = parseFixtures([
      { id: 'x', universe: 1, start: 1, footprint: 9999 },
    ]);
    expect(bad.ok).toBe(false);
    // 应用层不替换数据：旧索引核验结果不变
    expect(PatchIndex.build(fx).conflictGroups()).toEqual(before);
  });
});

/* ------------------------------------------------------------------ */
/* 随机差分：引擎 vs 朴素两两预言机                                      */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('随机差分测试', () => {
  it('多随机补丁的组与试移结果全部符合预言机', () => {
    const rand = mulberry32(20260919);
    for (let iter = 0; iter < 40; iter++) {
      const universeCount = 1 + Math.floor(rand() * 4);
      const n = 1 + Math.floor(rand() * 60);
      const raw: Raw[] = [];
      const used = new Set<string>();
      for (let i = 0; i < n; i++) {
        let id = '';
        do {
          id = `id${Math.floor(rand() * 100000)}`;
        } while (used.has(id));
        used.add(id);
        const footprint = 1 + Math.floor(rand() * 40);
        const start = 1 + Math.floor(rand() * (513 - footprint));
        raw.push({
          id,
          universe: 1 + Math.floor(rand() * universeCount),
          start,
          footprint,
        });
      }
      const fx = valid(raw);
      const index = expectGroupsMatch(fx);

      for (let k = 0; k < 30; k++) {
        const f = fx[Math.floor(rand() * fx.length)];
        const u = 1 + Math.floor(rand() * (universeCount + 2));
        const s = 1 + Math.floor(rand() * (513 - f.footprint));
        const t = index.trial(f.id, u, s);
        expect(t.ok).toBe(true);
        if (!t.ok) continue;
        expect(t.sourceConflicts).toEqual(
          oracleConflicts(fx, f, f.universe, f.start),
        );
        expect(t.targetConflicts).toEqual(oracleConflicts(fx, f, u, s));
        expect(t.canCommit).toBe(t.targetConflicts.length === 0);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* 性能：20 万灯具核验 + 2000 次试移 ≤ 4 秒，试移命中总数 ≤ 10000        */
/* ------------------------------------------------------------------ */

describe('性能预算', () => {
  it('200000 灯具核验与 2000 次试移在 4 秒内完成', () => {
    const UNIVERSES = 32_768;
    const rand = mulberry32(424242);
    const raw: Raw[] = [];
    for (let i = 0; i < 200_000; i++) {
      const footprint = 1 + Math.floor(rand() * 3);
      raw.push({
        id: `fix-${i.toString(36)}-${i}`,
        universe: 1 + Math.floor(rand() * UNIVERSES),
        start: 1 + Math.floor(rand() * (513 - footprint)),
        footprint,
      });
    }
    const fx = valid(raw);

    const t0 = performance.now();
    const index = PatchIndex.build(fx);
    const groups = index.conflictGroups();
    let hits = 0;
    for (let k = 0; k < 2000; k++) {
      const f = fx[Math.floor(rand() * fx.length)];
      const u = 1 + Math.floor(rand() * UNIVERSES);
      const s = 1 + Math.floor(rand() * (513 - f.footprint));
      const t = index.trial(f.id, u, s);
      if (!t.ok) throw new Error('random trial unexpectedly invalid');
      hits += t.sourceConflicts.length + t.targetConflicts.length;
    }
    const elapsed = performance.now() - t0;

    // 与预言机抽验组结构的健全性：组大小之和 = 参与冲突的灯具数
    let inConflict = 0;
    for (const f of fx) {
      if (
        index.conflictsAt(f.universe, f.start, f.footprint, f.id).length > 0
      ) {
        inConflict++;
      }
    }
    const grouped = groups.reduce((sum, g) => sum + g.ids.length, 0);
    expect(grouped).toBe(inConflict);

    // eslint-disable-next-line no-console
    console.log(
      `[perf] 核验+2000试移 ${elapsed.toFixed(0)}ms，冲突组 ${groups.length}，试移命中 ${hits}`,
    );
    expect(hits).toBeLessThanOrEqual(10_000);
    expect(elapsed).toBeLessThan(4000);
  });
});
