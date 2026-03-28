# 03 Agent and Projection

01 で task ベースの協調ループ、02 で manager 直接応答を実現した。
このプランでは **Agent を core の runtime abstraction として導入し、Projection を agent-aware にする**。

See also:

- [`01_minimal-multi-agent-plan.md`](01_minimal-multi-agent-plan.md)
- [`02_manager-direct-response.md`](02_manager-direct-response.md)
- [`goal-architecture.md`](goal-architecture.md)
- [`context-control-plane.md`](context-control-plane.md)

---

## 動機

### Conversation の問題

`Conversation` は以下の制約がある:

1. **threadId に束縛される** — 作成時に固定。agent は本来どの thread でも動けるべき
2. **入力が string 限定** — `sendUserMessage(text)` しかない。task instruction を渡すにも string 経由
3. **出力が Message 1個** — tool-call / tool-result は store に入るが return には含まれない
4. **名前が用途を限定している** — 「会話」は agent の1つの使い方にすぎない

execution engine が worker を動かすたびに新しい `Conversation` を作っているのは、この threadId 束縛のせい。

### Projection の問題

`pi-projection.ts` は:

1. **agent を区別しない** — manager も worker も同じ projection
2. **mode が 2 択** — `"conversation-only"` or `"with-tool-results"` だけ
3. **名前が PI に結びついている** — projection は runtime-agnostic な概念

---

## 設計

### Agent

Agent は `contexts → contexts` の runtime abstraction。

```ts
interface Agent {
  id: ContextId;
  run(input: AgentRunInput): Promise<AgentRunResult>;
}

type AgentRunInput = {
  threadId: ContextId;
  contexts: AnyContext[];
  hooks?: PiRuntimeRunHooks;
};

type AgentRunResult = {
  contexts: AnyContext[];
};
```

`run()` がやること:

1. projection で入力 contexts を text に変換
2. `PiRuntime.run()` を呼ぶ
3. hooks 経由で tool-call / tool-result を context 化
4. assistant message を context 化
5. 全ての産出 context を store に append
6. 産出 context を `AgentRunResult.contexts` として返す

#### Agent の設定

```ts
type CreateAgentInput = {
  id: ContextId;
  store: ContextStore;
  runtime: PiRuntime;
  projection: Projection;
  systemPrompt?: string;
};
```

- `threadId` はない — 実行時に渡す
- `projection` を agent ごとに持つ — manager と worker で異なる projection が可能

### Projection

Projection は `contexts → PiRunRequest` の変換関数。

```ts
type Projection = (contexts: AnyContext[], threadId: ContextId) => ProjectionResult;

type ProjectionResult = {
  systemPrompt?: string;
  transcript: string;
};
```

agent-aware な projection を作れるようにする。例:

```ts
// worker: thread の message + tool activity だけ見せる
function workerProjection(contexts, threadId) {
  return projectByTypes(contexts, threadId, ["thread", "message", "tool-call", "tool-result"]);
}

// manager: message のみ（tool activity は worker が見る）
function managerProjection(contexts, threadId) {
  return projectByTypes(contexts, threadId, ["thread", "message"]);
}
```

既存の `PiProjectionMode` ("conversation-only" / "with-tool-results") は、preset として残してもよい。

---

## 変更計画

### Phase 1 — Projection の整理

#### ファイル

- `packages/core/src/projection.ts` (新規)
- `packages/core/src/pi-projection.ts` (削除 or 薄いラッパーに)

#### 変更

`Projection` 型を導入:

```ts
type Projection = (contexts: AnyContext[], threadId: ContextId) => ProjectionResult;

type ProjectionResult = {
  systemPrompt?: string;
  transcript: string;
};
```

preset として提供:

```ts
function conversationProjection(systemPrompt?: string): Projection;
function fullProjection(systemPrompt?: string): Projection;
```

`toContextText` はそのまま使う。

`pi-projection.ts` の `projectContextsToPi` と `PiProjectionMode` は deprecated にするか削除。
`pi-runtime.ts` の `toPiInput` と `runContextsWithPi` は Agent に吸収される。

### Phase 2 — Agent の導入

#### ファイル

- `packages/core/src/agent.ts` (新規 — 既存の `agent.test.ts` は別物なので確認要)
- `packages/core/src/index.ts`

#### 変更

`createAgent()` を実装。中身は今の `createConversation` + `runContextsWithPi` の統合:

1. `run(input)` で threadId を受け取る
2. thread が store に無ければ作る
3. projection で contexts → text
4. `PiRuntime.run()` を hooks 付きで呼ぶ
5. hooks で tool-call / tool-result を context 化して store に append
6. assistant message を store に append
7. 産出した全 context を return

### Phase 3 — Conversation の削除

#### ファイル

- `packages/core/src/conversation.ts` (削除)
- `packages/core/src/conversation.test.ts` (agent.test.ts に移行)
- `packages/core/src/index.ts`

#### 変更

`Conversation` interface と `createConversation` を削除。
テストを agent ベースに書き換え。

### Phase 4 — ExecutionEngine の更新

#### ファイル

- `packages/core/src/execution-engine.ts`

#### 変更

`WorkerConfig` を `Agent` ベースに:

```ts
type WorkerConfig = {
  agent: Agent;
};
```

`runTask` の中で:
- `createConversation` の代わりに `agent.run({ threadId, contexts })` を呼ぶ
- return された `AgentRunResult.contexts` から assistant message を取り出して TaskResult に

### Phase 5 — CLI の更新

#### ファイル

- `packages/cli/src/index.ts`

#### 変更

- `createConversation` → `createAgent` に置き換え
- manager は `agent.run({ threadId: mainThread, contexts })` で直接応答
- user message の作成は CLI 側で行う（今の Conversation がやっていた仕事）
- `create_task` tool のロジックはそのまま

### Phase 6 — pi-runtime.ts の整理

#### ファイル

- `packages/core/src/pi-runtime.ts`

#### 変更

Agent に吸収された関数を削除:
- `toPiInput` — Agent 内部で projection を直接使う
- `runContextsWithPi` — Agent.run() に統合
- `createAssistantMessageFromPiResult` — Agent 内部のヘルパーに

残すもの:
- `PiRuntime` interface
- `PiRunRequest`, `PiRunResult`
- `PiRuntimeRunHooks` と event types

---

## 影響範囲

| ファイル | 操作 |
|---|---|
| `projection.ts` | 新規 |
| `agent.ts` | 新規 (core の createAgent) |
| `conversation.ts` | 削除 |
| `conversation.test.ts` | agent.test.ts に移行 |
| `pi-projection.ts` | 削除 |
| `pi-projection.test.ts` | projection.test.ts に移行 |
| `pi-runtime.ts` | 整理（helper 関数削除） |
| `pi-runtime.test.ts` | 整理 |
| `execution-engine.ts` | Agent ベースに更新 |
| `execution-engine.test.ts` | 更新 |
| `index.ts` (core) | export 更新 |
| `index.ts` (cli) | Agent ベースに更新 |
| `context-text.ts` | 変更なし |
| `context-store.ts` | 変更なし |
| `context-types.ts` | 変更なし |

---

## 完了条件

- `Agent` interface が `run(input) → AgentRunResult` を持つ
- `AgentRunResult.contexts` に assistant message + tool-call + tool-result が全て含まれる
- `Projection` が agent ごとに差し替え可能
- `Conversation` が削除されている
- execution engine が `Agent` を直接使う
- CLI が `Agent` を直接使う
- 全テスト pass
- 「こんにちは」→ manager が直接応答
- 「README.md を要約して」→ worker に委譲 → 結果合成
