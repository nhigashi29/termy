# 06 Async Task Semantics and Notifications

05 で dynamic agent context と lazy worker 解決を導入した。
このプランでは **task を正式に非同期 work assignment として定義し、待機・結果回収・通知を分離する**。

See also:

- [`05_dynamic-subagent-and-projection.md`](05_dynamic-subagent-and-projection.md)
- [`communication-patterns.md`](communication-patterns.md)
- [`goal-architecture.md`](goal-architecture.md)
- [`context-control-plane.md`](context-control-plane.md)

---

## 背景

現状の `create_task` は task を append したあと、そのまま `waitForTask()` して結果を返している。
これは使いやすい一方で、意味論としては曖昧さがある。

実際には次の3つが混ざっている:

1. **Task 作成** — work assignment を記録する
2. **Task 完了待機** — scheduler / manager の戦略
3. **Task 結果取得** — result を読む

このままだと:

- task が async job なのか sync tool call なのか不明瞭
- manager が fan-out / fan-in しづらい
- notification の役割が作れない
- conversation と task の境界が曖昧になる

---

## この phase の結論

### Task は非同期である

`Task` は「誰かに仕事を依頼し、後で結果を受け取る」ための context である。
したがって意味論としては **非同期** に固定する。

重要なのは:

- **task 自体は待たない**
- **待つかどうかは manager / caller の戦略**

つまり:

- `create_task` は task を作るだけ
- `wait_for_tasks` は待つための別操作
- `Notification` は完了や失敗を軽量に知らせる

---

## モデルの分離

この phase では communication primitives を次のように整理する。

### Conversation

- 同期
- turn-taking
- 応答を期待する
- thread 上の対話

### Task

- 非同期
- lifecycle を持つ
- result は後で返る
- work assignment に限定する

### Notification

- 非同期
- 軽量イベント
- 応答不要
- task 完了や状態変化の告知に使う

この分離により、task を conversation の代用品として使わないようにする。

---

## 追加する context type

```ts
type Notification = ContextNode<"notification", {
  kind:
    | "task-completed"
    | "task-failed"
    | "agent-idle"
    | "agent-busy";
  targetAgentId?: ContextId;
  taskId?: ContextId;
  threadId?: ContextId;
  message?: string;
}>;
```

この phase ではまず task / agent lifecycle に関係する最低限の notification から始める。

---

## ツールの意味論

### `create_task`

非ブロッキング。

```ts
params: {
  instruction: string;
  title?: string;
  agentRole?: string;
}

returns: {
  taskId: ContextId;
  assignedTo: ContextId;
}
```

動作:

1. agentRole に対応する agent を探す
2. いなければ `AgentContext` を append
3. `Task` を append
4. **すぐ返す**

### `wait_for_tasks`

ブロッキングだが、task 作成とは別。

```ts
params: {
  taskIds: ContextId[];
}

returns: {
  tasks: Array<{
    taskId: ContextId;
    status: "done" | "failed";
    output?: unknown;
    reason?: string;
  }>;
}
```

### `get_task_results`

待たずに現在の結果だけ確認する。

```ts
params: {
  taskIds: ContextId[];
}
```

これは polling や partial fan-in 用。

---

## Engine の責務

execution engine は次を担当する:

1. pending task を検知
2. worker を解決
3. task-status を `in-progress` にする
4. worker 実行
5. `task-result` と `task-status` を append
6. 対応する `notification` を append

例:

```ts
store.append(createContextNode({
  id: createContextId(),
  type: "notification",
  payload: {
    kind: "task-completed",
    taskId: task.id,
    targetAgentId: managerId,
    message: `task ${task.id} completed`,
  },
}));
```

notification は source of truth ではなく、**軽量な event view** として扱う。
source of truth は引き続き `task-status` と `task-result`。

---

## Projection の変更

### Manager projection

manager は thread 本文だけでなく、次も見えるべき:

- `agent`
- `agent-status`
- `task`
- `task-status`
- `task-result`
- `notification`

notification は result 本文より軽い overview 用。

例:

```text
agent researcher (worker)
agent-status agent:researcher idle
notification task-completed task:12
```

### Worker projection

この phase では worker projection は大きく変えない。
worker は引き続き:

- 自身の identity
- task
- 自分の working thread

を見ればよい。

---

## Manager の行動モデル

manager は次の2つの戦略を使い分ける。

### 1. fan-out / fan-in

複数 task を先に投げる。

```text
create_task(researcher)
create_task(analyst)
create_task(reviewer)
wait_for_tasks([...])
```

### 2. opportunistic collection

task を投げたあと、notification や projection を見ながら後で結果を拾う。

```text
create_task(...)
continue planning
later -> get_task_results(...)
```

このモデルにより、manager が task 完了待ちで必ず停止する設計から脱却できる。

---

## 変更計画

### ファイル

- `packages/core/src/context-types.ts`
- `packages/core/src/context-text.ts`
- `packages/core/src/context-store.ts`
- `packages/core/src/projection.ts`
- `packages/core/src/execution-engine.ts`
- `packages/core/src/execution-engine.test.ts`
- `packages/cli/src/index.ts`

### 変更

- `Notification` 型を追加
- `toContextText()` に notification rendering を追加
- `ContextStore` に notification query を追加してもよい
- Engine が task 完了 / 失敗時に notification を append
- `create_task` を non-blocking に変更
- `wait_for_tasks` ツールを追加
- `get_task_results` もしくは同等の結果回収ツールを追加
- manager projection に notification を含める

---

## 完了条件

- `Task` の意味論が async として明文化されている
- `create_task` が taskId を即返す
- `wait_for_tasks` で task completion を待てる
- task 完了 / 失敗時に `notification` が append される
- manager projection に notification が含まれる
- 既存の delegation が壊れない
- fan-out / fan-in のテストが通る

---

## 非 goals

この phase ではまだやらない:

- conversation thread の拡張
- meeting / broadcast / stream
- worker から manager への clarification 会話
- semantic recall
- summary / compression policy

これらは次の phase に回す。
