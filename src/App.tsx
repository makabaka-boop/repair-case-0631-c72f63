import { StrictMode, useMemo, useState } from 'react';
import { PatchIndex } from './core/engine';
import { parseFixtures } from './core/import';
import type { ConflictGroup, Fixture, TrialResult } from './core/types';

/* ------------------------------ 状态 ------------------------------ */

interface PatchState {
  fixtures: Fixture[];
  index: PatchIndex;
  groups: ConflictGroup[];
  verifyMs: number;
}

const IMPORT_ERROR_TEXT: Record<string, string> = {
  NOT_JSON_ARRAY: 'JSON 顶层必须是灯具数组',
  COUNT_OUT_OF_RANGE: '灯具数量必须在 1–200000 之间',
  MALFORMED_FIXTURE: '灯具对象缺少字段或结构错误',
  ID_NOT_ASCII: 'id 必须全部由 ASCII 字符组成',
  ID_BAD_LENGTH: 'id 长度必须在 1–32 之间',
  ID_DUPLICATE: 'id 在数组中重复',
  UNIVERSE_OUT_OF_RANGE: 'universe 必须是 1–32768 的整数',
  START_OUT_OF_RANGE: 'start 必须是 1–512 的整数',
  FOOTPRINT_OUT_OF_RANGE: 'footprint 必须是 1–512 的整数',
  RANGE_OVERFLOW: 'start + footprint 不得超过 513',
};

const TRIAL_ERROR_TEXT: Record<string, string> = {
  UNKNOWN_FIXTURE: '未找到该灯具 id',
  INVALID_TARGET_UNIVERSE: '目标 universe 必须是 1–32768 的整数',
  INVALID_TARGET_START: '目标 start 必须使整段落在 1–512 内',
};

function verify(fixtures: Fixture[]): Omit<PatchState, 'fixtures'> {
  const index = PatchIndex.build(fixtures);
  const t0 = performance.now();
  const groups = index.conflictGroups();
  const verifyMs = performance.now() - t0;
  return { index, groups, verifyMs };
}

/** 造一批稀疏、基本无冲突的演示数据（便于快速上手，非占位实现）。 */
function samplePatch(): Fixture[] {
  const raw: unknown[] = [];
  const rand = (() => {
    let a = 7;
    return () => {
      a = (a * 16807) % 2147483647;
      return a / 2147483647;
    };
  })();
  for (let i = 0; i < 200; i++) {
    raw.push({
      id: `FIX-${String(i + 1).padStart(4, '0')}`,
      universe: 1 + Math.floor(rand() * 8),
      start: 1 + Math.floor(rand() * 500),
      footprint: 1 + Math.floor(rand() * 4),
    });
  }
  // 刻意加入一个相交组
  raw.push(
    { id: 'HEAD', universe: 1, start: 1, footprint: 20 },
    { id: 'mid-1', universe: 1, start: 5, footprint: 3 },
    { id: 'TAIL', universe: 1, start: 20, footprint: 2 },
  );
  const r = parseFixtures(raw);
  if (!r.ok) throw new Error('sample generator produced invalid data');
  return r.fixtures;
}

/* ------------------------------ 组件 ------------------------------ */

function Workbench() {
  const [patch, setPatch] = useState<PatchState | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const [fixtureId, setFixtureId] = useState('');
  const [targetUniverse, setTargetUniverse] = useState('');
  const [targetStart, setTargetStart] = useState('');
  const [trial, setTrial] = useState<TrialResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const summary = useMemo(() => {
    if (!patch) return null;
    const conflictingIds = new Set<string>();
    for (const g of patch.groups) for (const id of g.ids) conflictingIds.add(id);
    return {
      groups: patch.groups.length,
      inConflict: conflictingIds.size,
      clean: patch.fixtures.length - conflictingIds.size,
    };
  }, [patch]);

  function loadJsonText(text: string, name: string | null): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setImportError('INVALID_PATCH：JSON 解析失败，旧补丁保留不变');
      return;
    }
    const r = parseFixtures(parsed);
    if (!r.ok) {
      setImportError(
        `INVALID_PATCH：${IMPORT_ERROR_TEXT[r.error.code] ?? r.error.code}` +
          `（数组下标 ${r.error.index}）。旧补丁保留不变`,
      );
      return;
    }
    setPatch({ fixtures: r.fixtures, ...verify(r.fixtures) });
    setImportError(null);
    setFileName(name);
    setTrial(null);
    setNotice(null);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => loadJsonText(String(reader.result ?? ''), file.name);
    reader.onerror = () =>
      setImportError(`INVALID_PATCH：文件 ${file.name} 读取失败，旧补丁保留不变`);
    reader.readAsText(file);
    e.target.value = '';
  }

  function runTrial(): void {
    if (!patch) return;
    setNotice(null);
    setTrial(patch.index.trial(fixtureId.trim(), toIntOrNan(targetUniverse), toIntOrNan(targetStart)));
  }

  function commitTrial(): void {
    if (!patch || !trial || !trial.ok || !trial.canCommit) return;
    const next = patch.index.commit(
      patch.fixtures,
      trial.id,
      Number(targetUniverse),
      Number(targetStart),
    );
    if (!next) {
      setNotice('目标位存在阻挡灯具，补丁未改变');
      return;
    }
    setPatch({ fixtures: next, ...verify(next) });
    setNotice(
      `已提交：${trial.id} → universe ${targetUniverse} / start ${targetStart}，已重新核验`,
    );
    setFixtureId(trial.id);
    setTrial(null);
  }

  return (
    <div className="page">
      <header>
        <h1>DMX 补丁冲突核验台</h1>
        <p className="sub">
          巡演换台前的离线补丁核验：导入本地 JSON（1–200000 项），全网列出相交连通分量，
          选定灯具试移新地址并确认目标位无阻挡后提交。
        </p>
      </header>

      <section className="card">
        <h2>1 · 导入补丁</h2>
        <div className="row">
          <label className="filebtn">
            选择本地 JSON 文件
            <input type="file" accept=".json,application/json" onChange={onFile} hidden />
          </label>
          <button type="button" onClick={() => loadJsonText(JSON.stringify(samplePatch()), null)}>
            载入 203 盏演示数据
          </button>
          {fileName && <span className="muted">当前文件：{fileName}</span>}
        </div>
        {importError && <div className="error">{importError}</div>}
        {patch && summary && (
          <div className="stats">
            <Stat label="灯具总数" value={patch.fixtures.length} />
            <Stat label="冲突组" value={summary.groups} warn={summary.groups > 0} />
            <Stat label="卷入冲突" value={summary.inConflict} warn={summary.inConflict > 0} />
            <Stat label="无冲突" value={summary.clean} />
            <Stat label="核验耗时" value={`${patch.verifyMs.toFixed(1)} ms`} />
          </div>
        )}
      </section>

      {patch && (
        <>
          <section className="card">
            <h2>2 · 试移灯具</h2>
            <div className="row trial-row">
              <label>
                灯具 id
                <input
                  value={fixtureId}
                  onChange={(e) => setFixtureId(e.target.value)}
                  placeholder="如 FIX-0001"
                  spellCheck={false}
                />
              </label>
              <label>
                新 universe（1–32768）
                <input
                  value={targetUniverse}
                  onChange={(e) => setTargetUniverse(e.target.value)}
                  inputMode="numeric"
                  placeholder="如 1"
                />
              </label>
              <label>
                新 start（1–512）
                <input
                  value={targetStart}
                  onChange={(e) => setTargetStart(e.target.value)}
                  inputMode="numeric"
                  placeholder="如 100"
                />
              </label>
              <button type="button" onClick={runTrial}>
                试移
              </button>
            </div>

            {trial && !trial.ok && (
              <div className="error">
                INVALID_TARGET：{TRIAL_ERROR_TEXT[trial.code] ?? trial.code}
              </div>
            )}
            {trial && trial.ok && (
              <div className="trial-result">
                <FixtureInfo
                  f={{
                    id: trial.id,
                    universe: trial.universe,
                    start: trial.start,
                    footprint: trial.footprint,
                  }}
                />
                <ConflictList
                  title="原位直接冲突"
                  ids={trial.sourceConflicts}
                  index={patch.index}
                />
                <ConflictList
                  title="目标位直接冲突（阻挡灯具）"
                  ids={trial.targetConflicts}
                  index={patch.index}
                  blocking
                />
                <div className="row">
                  {trial.canCommit ? (
                    <button type="button" className="primary" onClick={commitTrial}>
                      目标位为空，提交并重算
                    </button>
                  ) : (
                    <button type="button" disabled>
                      目标位存在阻挡，禁止提交（补丁不变）
                    </button>
                  )}
                </div>
              </div>
            )}
            {notice && <div className="ok">{notice}</div>}
          </section>

          <section className="card">
            <h2>3 · 冲突组（全网核验）</h2>
            {patch.groups.length === 0 ? (
              <p className="ok">全网无冲突：所有灯具在各自 universe 内区间互不相交。</p>
            ) : (
              <div className="groups">
                {patch.groups.map((g, gi) => (
                  <GroupRow key={`${g.universe}-${g.minStart}-${g.ids[0]}-${gi}`} group={g} />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {!patch && !importError && (
        <section className="card muted">
          尚未导入补丁。JSON 数组每项形如
          <code>{' { "id": "FIX-0001", "universe": 1, "start": 1, "footprint": 8 }'}</code>。
          非法文件会被拒绝并保留当前补丁。
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number | string; warn?: boolean }) {
  return (
    <div className={`stat${warn ? ' stat-warn' : ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function FixtureInfo({ f }: { f: Fixture }) {
  return (
    <p className="muted">
      灯具 <strong>{f.id}</strong>：universe {f.universe}，start {f.start}，footprint{' '}
      {f.footprint}，占用通道 {f.start}–{f.start + f.footprint - 1}
    </p>
  );
}

function ConflictList({
  title,
  ids,
  index,
  blocking,
}: {
  title: string;
  ids: string[];
  index: PatchIndex;
  blocking?: boolean;
}) {
  return (
    <div className={`conflict-block${ids.length > 0 && blocking ? ' blocking' : ''}`}>
      <h3>
        {title} <span className="badge">{ids.length}</span>
      </h3>
      {ids.length === 0 ? (
        <p className="muted">（空）</p>
      ) : (
        <ul className="idlist">
          {ids.map((id) => {
            const f = index.getFixture(id);
            return (
              <li key={id}>
                <code>{id}</code>
                {f && (
                  <span className="muted">
                    {' '}
                    u{f.universe} s{f.start}+{f.footprint}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function GroupRow({ group }: { group: ConflictGroup }) {
  return (
    <details className="group">
      <summary>
        <span className="group-head">
          universe <strong>{group.universe}</strong> · 最小 start {group.minStart} ·{' '}
          {group.ids.length} 盏 · 首 id <code>{group.ids[0]}</code>
        </span>
      </summary>
      <ul className="idlist">
        {group.ids.map((id) => (
          <li key={id}>
            <code>{id}</code>
          </li>
        ))}
      </ul>
    </details>
  );
}

function toIntOrNan(s: string): number {
  if (!/^[+-]?\d+$/.test(s.trim())) return Number.NaN;
  return Number(s.trim());
}

export default function App() {
  return (
    <StrictMode>
      <Workbench />
    </StrictMode>
  );
}
