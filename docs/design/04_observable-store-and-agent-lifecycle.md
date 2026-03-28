# 04 Observable Store and Agent Lifecycle

03 で Agent を core の runtime abstraction として導入した。
このプランでは **Agent lifecycle を context として可視化し、Observable ContextStore で reactive な dispatch を実現する**。

See also:

- [`03_agent-and-projection.md`](03_agent-and-projection.md)
- [`goal-architecture.md`](goal-architecture.md)
- [`context-control-plane.md`](context-control-plane.md)
- [`communication-patterns.md`](communication-patterns.md)

---

## 動機

### Agent の存在が見えない

現在の `AgentContext` は静的レコード（name, role）のみ。
「誰が走っているか」「今何をしているか」は context に存在しない。

結果:

1. **manager が worker の状態を知れない** — projection にも現れない
2. **デバッグが難しい** — journal を見ても agent の起動・停止がわからない
3. **ルーティング判断ができない** — 「busy な agent を避ける」が不可能

### ExecutionEngine が受動的

現在の `tick()` は呼び出し側が手動で蹴る必要がある。
CLI の `createTaskTool` 内で `await engine.tick()` を書いているのは、この制約のため。

問題:

1. **Task を作る側が engine を知っている必要がある** — 結合が強い
2. **複数箇所から task を作ると、全箇所に tick() が必要** — 漏れやすい
3. **engine が自律的に動けない** — reactive dispatch ができない

---

## 設計

### Agent Lifecycle Context

Agent の状態変化を context として記録する。

```ts
type AgentRunStatus = "idle" | "running";

type AgentStatus = ContextNode<
  "agent-status",
  {
    agentId: ContextId;
    status: AgentRunStatus;
    taskId?: ContextId;       // running 時に何の task か
    threadId?: ContextId;     // running 時にどの thread か
  }
>;
```

ライフサイクル:

```
agent 登録     → AgentContext (既存。name, role)
agent 起動     → AgentStatus { status: "running", taskId, threadId }
agent 完了     → AgentStatus { status: "idle" }
```

`AgentStatus` は append-only。最新の `agent-status` を見れば現在の状態がわかる。

#### 用途

- **Projection**: manager の projection に worker の状態を含められる
- **ルーティング**: `listIdleAgents()` で空いている agent を選べる
- **Observability**: journal に agent lifecycle が残る

### Observable ContextStore

`subscribe` メソッドを `ContextStore` に追加する。

```ts
interface ContextStore {
  // 既存...
  subscribe(listener: (context: AnyContext) => void): () => void;
}
```

- `append()` / `appendMany()` のたびに listener を同期呼び出し
- `subscribe()` は unsubscribe 関数を返す
- listener は同期実行（listener 内で async 処理が必要なら呼び出し側がキューイング）

### ExecutionEngine の reactive 化

Engine は `subscribe` で task の追加を検知し、自動的に dispatch する。

```ts
interface ExecutionEngine {
  start(): () => void;     // subscribe 開始。unsubscribe 関数を返す
  tick(): Promise<void>;   // 既存。手動 / watchdog 用に残す
}
```

`start()` の中身:

```ts
function start() {
  return store.subscribe((context) => {
    if (context.type === "task") {
      // 非同期で dispatch（subscribe listener は同期なので queue に積む）
      enqueue(() => runTask(context));
    }
  });
}
```

#### Task dispatch の流れ (After)

```
store.append(task)
  ↓ subscribe listener が発火
ExecutionEngine: enqueue(runTask)
  ↓
AgentStatus { status: "running" } を append
Agent.run()
AgentStatus { status: "idle" } を append
TaskResult / TaskStatus を append
```

CLI 側は `engine.tick()` を呼ぶ必要がなくなる:

```ts
// Before (cli/index.ts createTaskTool)
store.append(task);
await engine.tick();        // ← 手動

// After
store.append(task);
// → subscribe で自動 dispatch
// ただし task tool は結果を待つ必要があるので、
// engine.waitForTask(taskId) のようなヘルパーが必要
```

### Task 完了待ち

`createTaskTool` が同期的に結果を返す必要があるため、task の完了を待つ仕組みが要る。

```ts
interface ExecutionEngine {
  start(): () => void;
  tick(): Promise<void>;
  waitForTask(taskId: ContextId): Promise<void>;
}
```

`waitForTask` は内部で Promise を作り、対象 task の `task-status` が done/failed になったら resolve する。

---

## 変更計画

### Phase 1 — AgentStatus context type

#### ファイル

- `packages/core/src/context-types.ts`
- `packages/core/src/context-text.ts`
- `packages/core/src/context-store.ts`

#### 変更

`AgentStatus` 型を追加:

```ts
type AgentRunStatus = "idle" | "running";

type AgentStatus = ContextNode<
  "agent-status",
  {
    agentId: ContextId;
    status: AgentRunStatus;
    taskId?: ContextId;
    threadId?: ContextId;
  }
>;
```

- `AnyContext` union に追加
- `toContextText` にレンダリングを追加
- `context-store.ts` に `latestAgentStatus(agentId)` を追加

### Phase 2 — Observable ContextStore

#### ファイル

- `packages/core/src/context-store.ts`
- `packages/core/src/context-store.test.ts`

#### 変更

`ContextStore` interface に追加:

```ts
subscribe(listener: (context: AnyContext) => void): () => void;
```

実装:

- listeners を `Set<(context: AnyContext) => void>` で管理
- `append()` で全 listener を呼ぶ
- `appendMany()` で各 context ごとに全 listener を呼ぶ
- `subscribe()` は listener を追加し、削除関数を返す

### Phase 3 — ExecutionEngine の reactive 化

#### ファイル

- `packages/core/src/execution-engine.ts`
- `packages/core/src/execution-engine.test.ts`

#### 変更

`ExecutionEngine` interface を拡張:

```ts
interface ExecutionEngine {
  start(): () => void;
  tick(): Promise<void>;
  waitForTask(taskId: ContextId): Promise<void>;
}
```

`start()`:

- `store.subscribe()` で task 追加を監視
- 新しい task を検知したら非同期で `runTask()` を呼ぶ
- task 実行前に `AgentStatus { running }` を append
- task 完了後に `AgentStatus { idle }` を append

`waitForTask(taskId)`:

- 内部で Promise を作り、store.subscribe で `task-status` done/failed を待つ
- タイムアウトは将来の拡張として残す

`tick()`:

- 既存のまま残す（watchdog / テスト用）

### Phase 4 — CLI の更新

#### ファイル

- `packages/cli/src/index.ts`

#### 変更

- `engine.start()` をブート時に呼ぶ
- `createTaskTool` から `engine.tick()` を削除し、`engine.waitForTask(taskId)` に置き換え
- cleanup 時に `engine.start()` の返り値で unsubscribe

---

## 影響範囲

| ファイル | 操作 |
|---|---|
| `context-types.ts` | AgentStatus 追加 |
| `context-text.ts` | AgentStatus レンダリング追加 |
| `context-store.ts` | subscribe 追加, latestAgentStatus 追加 |
| `context-store.test.ts` | subscribe テスト追加 |
| `execution-engine.ts` | start(), waitForTask() 追加, AgentStatus 発行 |
| `execution-engine.test.ts` | reactive dispatch テスト追加 |
| `index.ts` (core) | export 更新（必要なら） |
| `index.ts` (cli) | engine.start() / waitForTask() に移行 |
| `context-text.ts` | 変更なし以外は上記 |
| `agent.ts` | 変更なし |
| `projection.ts` | 変更なし |

---

## 完了条件

- `AgentStatus` context type が定義されている
- `ContextStore.subscribe()` が append のたびに listener を呼ぶ
- `ExecutionEngine.start()` が subscribe で task を自動 dispatch する
- `ExecutionEngine.waitForTask()` で task 完了を待てる
- task 実行前後に `AgentStatus` (running/idle) が store に記録される
- CLI が `engine.tick()` を直接呼ばなくなっている
- 全テスト pass
- 「こんにちは」→ manager が直接応答（変化なし）
- 「README.md を要約して」→ task 作成 → engine が自動検知 → worker 実行 → 結果合成
