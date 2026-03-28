# 05 Dynamic Subagent and Projection Enrichment

04 で Observable Store と Agent Lifecycle を導入した。
このプランでは **projection を充実させ、Engine が動的に subagent を生成できるようにする**。

See also:

- [`04_observable-store-and-agent-lifecycle.md`](04_observable-store-and-agent-lifecycle.md)
- [`goal-architecture.md`](goal-architecture.md)
- [`context-control-plane.md`](context-control-plane.md)

---

## 動機

### Manager が「誰がいるか」を知らない

Store には `AgentContext` と `AgentStatus` が入っている。
しかし manager の projection は thread の message しか含めていない。

結果:

1. Manager は agent 一覧を見れない — 「reader に任せよう」と判断できない
2. AgentStatus が store にあっても projection に出ない — 04 の成果が活きない
3. 動的 subagent を作る判断材料がない

### Worker が「自分が何をしているか」を知らない

現在の `runTask()`:

```ts
worker.agent.run({
  contexts: [{ role: "user", text: task.instruction }]
})
```

Worker が受け取るのは instruction 文字列1つだけ。

知らないこと:

- 自分が誰か（AgentContext）
- どの task をやっているか（Task context）
- ユーザーが元々何を聞いたか（parent thread）

### Subagent が静的に固定されている

Engine の `workers` は constructor 時に固定:

```ts
createExecutionEngine({ store, workers: [{ agentId, agent }] })
```

Manager が「新しい種類の agent が要る」と判断しても、runtime 上に worker を作る手段がない。

---

## 設計原則

context-first の思想に従う:

1. **Spawn は context 操作である** — `AgentContext` を store に append することが spawn。特別な spawn API は不要。
2. **Engine は runtime の関心事** — store 上の context を見て、必要な runtime worker を lazy に解決する。
3. **Projection が agent の視界を決める** — 何が見えるかは projection の責務。caller が渡す context と projection の filter で制御する。

---

## 設計

### Phase 1: Projection の充実

#### Manager projection

Manager が見るべき context:

```
[agents]
agent reader (worker) — idle
agent researcher (worker) — running task:2

[thread: main]
user: README.mdを要約して
assistant: readerに任せます
task task:1: README.mdを要約して
task-status task:1 done
task-result task:1 "READMEの内容は..."
```

Manager の projection に含める type を追加:

- `agent` — 誰がいるか
- `agent-status` — 誰が何をしているか

これらは thread-scoped ではなくグローバル。

```ts
export function managerProjection(systemPrompt?: string): Projection {
  return (contexts, threadId) => {
    const agents = contexts.filter(
      (c) => c.type === "agent" || c.type === "agent-status",
    );
    const thread = contexts.filter(
      (c) => isThreadOrThreadScoped(c, threadId),
    );
    return {
      systemPrompt,
      transcript: [...agents, ...thread].map(toContextText).join("\n"),
    };
  };
}
```

**CLI 側の変更**: manager に渡す context を `store.listThread()` → `store.list()` に変更。
projection が必要なものだけ filter する。

#### Worker projection

Worker が見るべき context:

```
[identity]
agent reader (worker)

[task]
task task:1: README.mdを要約して

[thread: worker-thread]
user: README.mdを要約して
```

Engine の `runTask()` が worker に渡す context を充実させる:

```ts
const workerContexts = [
  store.get(worker.agentId),     // AgentContext — 自分が誰か
  task,                           // Task — 何をやっているか
  ...parentThreadSummary,         // parent thread から要約 or 最新メッセージ
  userMessage,                    // instruction を message として
];
```

Worker 用の projection:

```ts
export function workerProjection(systemPrompt?: string): Projection {
  return (contexts, threadId) => {
    const identity = contexts.filter((c) => c.type === "agent");
    const tasks = contexts.filter(
      (c) => c.type === "task" || c.type === "task-status",
    );
    const thread = contexts.filter(
      (c) => isThreadOrThreadScoped(c, threadId),
    );
    return {
      systemPrompt,
      transcript: [...identity, ...tasks, ...thread].map(toContextText).join("\n"),
    };
  };
}
```

### Phase 2: 動的 subagent

#### AgentFactory

Runtime worker を生成する関数。Engine に注入する。

```ts
type AgentFactory = (agentId: ContextId, store: ContextStore) => Agent;
```

Factory の責務:

1. `store.get(agentId)` で AgentContext を取得（role, name を知る）
2. PiRuntime を生成（CLI 依存。core は型だけ定義）
3. `createAgent()` で Agent を返す

```ts
// CLI での実装例
function createAgentFactory(runtimeFactory: () => Promise<PiRuntime>): AgentFactory {
  return async (agentId, store) => {
    const runtime = await runtimeFactory();
    return createAgent({
      id: agentId,
      store,
      runtime,
      projection: workerProjection(),
    });
  };
}
```

注: AgentFactory は async になる可能性がある（runtime 生成が async のため）。

```ts
type AgentFactory = (agentId: ContextId, store: ContextStore) => Agent | Promise<Agent>;
```

#### Engine の lazy worker 解決

`createExecutionEngine` の input に `agentFactory` を追加:

```ts
type CreateExecutionEngineInput = {
  store: ContextStore;
  workers?: WorkerConfig[];         // 初期 worker（省略可）
  agentFactory?: AgentFactory;      // 動的生成用
};
```

`runTask()` の変更:

```ts
async function runTask(task: Task): Promise<void> {
  let worker = workersByAgentId.get(task.payload.assignedTo);

  if (!worker && agentFactory) {
    const agent = await agentFactory(task.payload.assignedTo, store);
    worker = { agentId: task.payload.assignedTo, agent };
    workersByAgentId.set(worker.agentId, worker);
  }

  if (!worker) return;
  // ... 既存の実行ロジック
}
```

#### create_task ツールの変更

Manager が agent key を指定して task を作れるようにする。
Agent が store に存在しなければ、ツール内で `AgentContext` を append する。

```ts
// Before
params: { instruction: string; title?: string }
// task は固定の workerId に assign

// After
params: { instruction: string; title?: string; agentRole?: string }
// agentRole があれば、その role の agent を探すか新規作成
```

フロー:

```
Manager: create_task({ instruction: "...", agentRole: "researcher" })
  ↓
create_task:
  1. store から role="researcher" の agent を探す
  2. いなければ AgentContext を append（spawn = context 操作）
  3. Task を append（assignedTo = その agent の id）
  ↓
Engine (subscribe で検知):
  4. worker がいない → agentFactory で runtime worker 生成
  5. worker.run() を充実した context 付きで実行
  6. AgentStatus (running → idle) を append
```

---

## 変更計画

### Phase 1 — Projection の充実

#### ファイル

- `packages/core/src/projection.ts`
- `packages/core/src/projection.test.ts`
- `packages/core/src/execution-engine.ts`
- `packages/cli/src/index.ts`

#### 変更

- `managerProjection()` を追加（agent, agent-status + thread-scoped contexts）
- `workerProjection()` を追加（agent identity + task + thread）
- Engine の `runTask()` が worker に渡す context を充実させる
- CLI: manager に `store.list()` を渡し、`managerProjection` を使う

### Phase 2 — 動的 subagent

#### ファイル

- `packages/core/src/execution-engine.ts`
- `packages/core/src/execution-engine.test.ts`
- `packages/core/src/index.ts`
- `packages/cli/src/index.ts`

#### 変更

- `AgentFactory` 型を定義
- `createExecutionEngine` に `agentFactory` option を追加
- `runTask()` に lazy worker 解決を追加
- CLI: `AgentFactory` の実装を提供
- `create_task` ツールに `agentRole` パラメータ追加
- role ベースで既存 agent を探す or 新規 `AgentContext` を append

---

## Store クエリの追加

Phase 1・2 を支えるために `ContextStore` に追加:

```ts
interface ContextStore {
  // 既存...
  listAgents(): AgentContext[];
  findAgentByRole(role: string): AgentContext | undefined;
}
```

---

## 影響範囲

| ファイル | 操作 |
|---|---|
| `projection.ts` | `managerProjection`, `workerProjection` 追加 |
| `projection.test.ts` | 新 projection のテスト追加 |
| `context-store.ts` | `listAgents()`, `findAgentByRole()` 追加 |
| `context-store.test.ts` | 新クエリのテスト追加 |
| `execution-engine.ts` | `AgentFactory`, lazy worker 解決, worker context 充実 |
| `execution-engine.test.ts` | 動的 subagent テスト追加 |
| `index.ts` (core) | export 更新 |
| `index.ts` (cli) | `managerProjection` 使用, `store.list()` 渡し, `AgentFactory` 実装, `create_task` 更新 |

---

## 完了条件

### Phase 1

- Manager の projection に agent 一覧と AgentStatus が含まれる
- Worker の projection に task と自身の AgentContext が含まれる
- Engine の `runTask()` が worker に充実した context を渡す
- 全テスト pass
- 既存の動作が壊れない（「こんにちは」→ 直接応答、delegation → worker 実行）

### Phase 2

- `AgentFactory` 型が定義されている
- Engine が未知の agent への task を検知したとき factory で worker を生成する
- `create_task` で `agentRole` を指定して新しい agent を動的に作れる
- 動的に作られた agent が task を実行し、結果を返す
- AgentStatus (running/idle) が動的 agent にも記録される
- 全テスト pass
