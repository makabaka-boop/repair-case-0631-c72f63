# DMX 补丁冲突核验台

巡演换台前使用的**纯离线** DMX 补丁（patch）冲突核验工具。浏览器内完成一切计算：
不调用任何外部服务、不上传数据。React + TypeScript + Vite 单页应用，核心算法在
`src/core/` 下且不依赖 DOM，可被 Vitest 直接测试。

## 运行

```bash
npm install
npm run dev        # 本地开发
npm test           # Vitest 单元/性能测试
npm run verify     # tsc --noEmit && vitest run && vite build，全绿才算验收通过
npm run build      # 生产构建到 dist/
```

### Docker Compose

```bash
docker compose up --build web        # 默认 http://localhost:8080
WEB_PORT=9000 docker compose up --build web
docker compose up --build verify     # 容器内跑 verify 验收（类型检查+测试+构建）
```

`WEB_PORT` 是可覆盖的宿主机发布端口（默认 `8080`），容器内 Vite 固定监听 5173。

## 数据契约

从本地导入一个 **JSON 数组**，长度 **1–200000** 项。每项：

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | string | 唯一；1–32 个 **ASCII** 字符（码位 0x00–0x7F） |
| `universe` | integer | 1–32768 |
| `start` | integer | 1–512 |
| `footprint` | integer | 1–512，且 `start + footprint <= 513` |

灯具占用其 universe 内的闭区间 `[start, start + footprint − 1]`（末端 ≤ 512）。

样例：见 [`sample-fixtures.json`](./sample-fixtures.json)，也可点界面上的
「载入 203 盏演示数据」。

### 非法输入 = `INVALID_PATCH`

顶层不是数组、数量越界、缺字段/结构错误、非整数、id 非 ASCII 或长度非法、id 重复、
universe/start/footprint 越界、`start + footprint > 513` —— 一律拒绝导入，界面显示
**INVALID_PATCH**（附原因与数组下标），**当前已加载的旧补丁原样保留**。
几何上的地址相交不属于导入错误，而由核验报告为冲突。

## 冲突核验

- 同一 universe 内，两个灯具的**闭区间相交**即冲突——共享通道即冲突；
  恰好相邻（一个 end 在另一个 start 的前一通道）不冲突。不同 universe 永不冲突。
- 把相交关系看作无向图，列出所有**连通分量**作为冲突组（单独灯具不成组、不列出）。
- **组内 id 按 UTF-8 字节序**升序排列（ASCII 数据即等同于码元序，大写字母排在小写前）。
- **组按 `(universe, 组内最小 start, 组首 id)` 升序排列。**

## 试移与提交

1. 输入灯具 id 与**合法的新 `universe` 与 `start`**（footprint 沿用原值，新区间也必须
   落在 1–512 内），点「试移」——不改变任何数据。
2. 分别列出：
   - **原位直接冲突**：灯具留在原地址时与其区间直接相交的 id；
   - **目标位直接冲突（阻挡灯具）**：移到新地址后会与其相交的 id。
   两者都是**直接**相交（不做传递展开），按 UTF-8 字节序排列。
3. 目标列表**为空**时才允许「提交并重算」：移动灯具并重新全网核验。
4. 目标列表非空时提交按钮禁用；即使强行调用 `commit()` 也返回 `null`，**补丁不变**，
   阻挡灯具在界面上完整可见。非法目标返回 `INVALID_TARGET`。

一次成功移动可把冲突组**拆开**（如链形组中移走桥接灯具 → 两个独立小组），
也可在原位无冲突时保留原地址不变。

## 核心模块

| 文件 | 职责 |
|---|---|
| `src/core/types.ts` | 数据类型与错误码 |
| `src/core/utf8.ts` | ASCII 校验、UTF-8 字节序比较 |
| `src/core/import.ts` | JSON 导入校验（INVALID_PATCH） |
| `src/core/engine.ts` | `PatchIndex`：空间索引、试移、提交、连通分量核验 |
| `src/core/engine.test.ts` | 朴素两两预言机差分测试与性能预算测试 |

### 算法

- 每个 universe 按起始通道分 512 桶，桶内按 end 降序；冲突查询沿通道扫描，
  复杂度 O(512 + 命中数)。
- 全网核验按 start 扫线 + end 小顶堆 + 并查集求连通分量：扫到某灯具时，
  堆中所有未过期灯具都覆盖当前起点、彼此必已连通，故只需与堆顶合并一次。
  总复杂度 O(n log n)。

### 测试

Vitest 用 **O(n²) 朴素两两枚举 + DFS** 作预言机，对随机补丁与手工构造做差分，覆盖：

- **端点相接**（`[1,2]` 与 `[2]` 冲突、`[1]` 与 `[2]` 不冲突）；
- **嵌套**（大区间内含互不接触的小灯 → 同组）；
- **组拆分**（移走桥接灯具后一组变两组，与预言机逐一对比）；
- 排序契约、导入校验、试移/提交拒绝、非法导入保留旧补丁。
- **性能预算**：20 万灯具构建+核验并做 2000 次随机试移，实测约 0.4–0.7 秒，
  阈值 **4 秒**；2000 次试移命中总数阈值 **10000**（实测约百级）。
