# 07 Runtime Scheduler, Non-Preemptive Reactions, and Communication-Aware Orchestration

06 で task を非同期 work assignment として定義し、notification を導入した。
この phase では、notification だけに orchestration を寄せるのではなく、
**runtime scheduler が複数の communication primitive を統合して扱う** 方向へ設計を整理する。

この文書の主眼は、manager 固有の event loop ではなく、
**non-preemptive な runtime scheduling** を基本機構として定義することにある。

See also:

- [`06_async-task-semantics-and-notifications.md`](06_async-task-semantics-and-notifications.md)
- [`communication-patterns.md`](communication-patterns.md)
- [`goal-architecture.md`](goal-architecture.md)
- [`context-control-plane.md`](context-control-plane.md)

---

## 背景

06 により次の primitives は揃った:

- `Task` — async work assignment
- `TaskStatusChange` — lifecycle
- `TaskResult` — completion payload
- `Notification` — lightweight event

しかし、notification をそのまま orchestration の中心に置くと限界がある。

たとえば将来的には、次のような coordination が必要になる:

- manager が `task-completed` を見て fan-in する
- worker が manager に clarification を求める
- reviewer が implementer にコメントを返す
- 複数 agent が meeting thread で議論する

これらはすべて notification だけでは表現しにくい。

特に区別すべきものは次の 3 つである:

1. **Task** — 非同期の work assignment
2. **Notification** — 軽量な event / wake-up hint
3. **Message / Thread** — 双方向で返信を伴いうる communication

したがって、この phase では notification reaction を runtime primitive として残しつつ、
それを **scheduler の入力のひとつ** に位置づけ直す。

---

## この phase の結論

### runtime の基本機構は manager event loop ではなく scheduler とする

runtime は notification 専用の reaction loop ではなく、
**communication-aware scheduler** として動く。

scheduler は少なくとも次を扱う:

- pending task
- pending notification
- pending reply / message reaction
- agent runtime state (`idle`, `running`, `waiting` など)

manager はその scheduler の最初の consumer ではあるが、中心概念ではない。

### notification reaction は残すが、全体モデルの一部に下げる

notification に反応して actor を起動する仕組みは引き続き必要である。
ただしそれは orchestration 全体ではなく、
**「schedulable work を発生させる 1 つの仕組み」** として扱う。

### agent run は non-preemptive を原則とする

通常の communication に対しては、agent 実行中の割り込みは行わない。

つまり:

- run 中に新しい notification / message / task が来ても基本は止めない
- 新しい work は queue に積む
- 現在の run が終わった後に scheduler が次を dispatch する

### cancel / timeout は notification と分離する

本当に割り込みが必要なもの:

- cancel
- abort
- timeout
- hard budget stop

は notification reaction ではなく、**runtime control signal** として別扱いにする。

---

## 目標

### 1. notification を scheduler の入力として定義する

notification は append-only context であり続ける。
ただしその役割は、単なる可視化用イベントではなく、
**scheduler に work を発生させる入力** になる。

### 2. runtime mechanism と communication semantics を分離する

分けるべきもの:

- **communication semantics** — task / notification / message / meeting が何を意味するか
- **runtime scheduling** — どの agent をいつ起動するか
- **control signals** — 実行を止めるかどうか

### 3. 双方向通信と将来の meeting を見据えた土台を作る

この phase では full meeting はまだ実装しない。
ただし将来の:

- clarification request
- manager ↔ worker の往復
- reviewer ↔ implementer のやりとり
- multi-agent meeting

を阻害しない scheduler semantics を選ぶ。

### 4. manager を最初の reactive consumer とする

最初の実装では manager が:

- `task-completed`
- `task-failed`

を受けて動く。

ただしこれは manager policy であり、runtime の一般機構そのものではない。

---

## 基本モデル

### Communication primitives

この設計では、主要な coordination primitive を次のように整理する。

#### Task

```ts
type Task = ContextNode<"task", {
  assignedTo: ContextId;
  threadId?: ContextId;
  instruction: string;
}>;
```

- 非同期の work assignment
- 明示的な owner がいる
- completion は `task-status` / `task-result` で表現する

#### Notification

```ts
type Notification = ContextNode<"notification", {
  kind: string;
  targetAgentId?: ContextId;
  taskId?: ContextId;
  threadId?: ContextId;
  message?: string;
}>;
```

- 軽量な event
- 返信を期待しない
- wake-up hint / fan-in trigger / state change announcement に向く

例:

- `task-completed`
- `task-failed`
- `review-requested`
- `artifact-updated`

#### Message / Thread

message は conversational contribution であり、
notification と違って返信や対話の継続を伴いうる。

将来的には以下のような表現を取りうる:

```ts
type Message = ContextNode<"message", {
  threadId: ContextId;
  role: "user" | "assistant" | "agent" | "system";
  text: string;
  mentions?: ContextId[];
  replyRequestedFrom?: ContextId[];
}>;
```

この phase では reply semantics を full 実装しなくてもよいが、
少なくとも notification と message は意味的に区別しておく。

---

## agent run semantics

### Non-preemptive by default

この phase の基本方針は:

> **notification reactions and communication-triggered runs are non-preemptive by default.**

つまり:

- agent が実行中なら通常の通知では止めない
- その agent 向けの work は pending queue に積む
- run 完了後に queue を flush する

これは manager だけでなく、将来の worker / reviewer / summarizer にも共通する。

### なぜ割り込まないか

割り込みを許すと次が難しくなる:

- LLM run の安全な suspend / resume
- tool 実行途中の整合性
- 編集途中や multi-step 操作途中の中断
- なぜそのタイミングで切り替わったかという説明可能性

そのため、通常の orchestration は preemptive interrupt よりも、
**short runs + queued follow-up** で組み立てる方が自然である。

### 将来の拡張: cooperative yield

将来的には step 境界ごとに queue を確認する cooperative scheduling を入れてもよい。
ただしこの phase ではまず non-preemptive を標準とする。

---

## scheduler の責務

runtime scheduler の責務は次のとおり:

1. store を監視して新しい work を検出する
2. notification / task / reply-needed などから schedulable work を組み立てる
3. agent state を見て即 dispatch するか defer するか決める
4. batching / debouncing で短時間の burst を集約する
5. safe なタイミングで actor / agent を起動する

重要なのは、scheduler は **notification を直接実行する** のではなく、
**pending work を生成・集約・dispatch する** ことである。

---

## PendingWork の考え方

notification 専用 queue にするより、pending work を一般化しておく方がよい。

例:

```ts
type PendingWork =
  | { kind: "task"; agentId: ContextId; taskId: ContextId }
  | { kind: "notification"; agentId: ContextId; notificationIds: ContextId[] }
  | { kind: "reply"; agentId: ContextId; threadId: ContextId; messageIds: ContextId[] };
```

この phase で最低限必要なのは `task` と `notification` だが、
将来の双方向通信に備えて `reply` も入る形を想定しておく。

---

## agent runtime state

scheduler は agent ごとの runtime state を持つべきである。

例:

```ts
type AgentRuntimeState = "idle" | "running" | "waiting" | "stopped";
```

### idle
- 新しい work を受けられる

### running
- 現在 run 中
- 通常 notification では割り込まない

### waiting
- 他 agent や user からの返答待ち
- policy によっては別 work を入れてもよいが、最初は保守的でよい

### stopped
- dispatch 対象外

この phase の最初の実装では `idle | running` だけでもよい。
ただし文書上は `waiting` を見据えておくと次 phase につながる。

---

## notification subscription

subscription の考え方自体は引き続き有効である。

```ts
type NotificationSubscription = {
  subscriberAgentId: ContextId;
  kinds: string[];
};
```

ただしこれは:

- runtime config
- in-memory registration

として始めれば十分であり、まだ durable context にしなくてよい。

重要なのは、subscription は
**notification → pending work を生成するルール** であって、
それ自体が scheduler 全体ではないという点である。

---

## dispatch policy

### 1. agent が idle のとき

- matching work を検出する
- debounce window を少し待つ
- まとめて dispatch する

### 2. agent が running のとき

- work を pending queue に積む
- 同種の notification は coalesce する
- current run 完了後に flush する

### 3. agent が waiting のとき

この phase では単純化して defer でもよい。
将来的には waiting 中でも別 thread の work を許容する policy を導入できる。

---

## batching / debouncing

notification や task completion は短時間に連続で来る可能性が高い。
そのため scheduler は軽い batching を持つべきである。

例:

- 500ms〜2s の window でまとめる
- 同一 subscriber 向け notification を集約する
- 同一 task batch の completion を fan-in しやすい形にする

これは manager に特に有効だが、将来の reviewer や summarizer にも共通する一般機構である。

---

## manager policy

manager はこの phase の最初の reactive consumer として、次を行う。

### Trigger

- `task-completed`
- `task-failed`

### Reaction

1. task result / status を回収する
2. 必要なら fan-in する
3. 必要なら follow-up task を作る
4. internal note / summary を残す

ここで重要なのは、これは **manager 固有の policy** であり、
runtime scheduler そのものではないという点である。

---

## internal-first 方針

最初の実装では、reaction による run は **internal-only** に寄せる。

つまり:

- runtime が manager を起動する
- manager は結果を回収して internal record を残す
- user-facing thread にはまだ自動投稿しない

これにより UI を騒がしくせず、coordination layer を育てられる。

後で必要なら user-visible promotion を追加する。

---

## orchestration thread

reaction や内部 coordination を user-facing thread と分離するため、
internal orchestration thread を導入してよい。

例:

```text
thread runtime:control
notification task-completed task:12
notification task-failed task:13
assistant: collected task 12 result; task 13 needs retry
```

これは manager 専用というより、scheduler / orchestration 用の internal thread と考える方がよい。

---

## 双方向通信との関係

この phase では full な clarification flow や meeting はまだ扱わない。
ただし scheduler semantics はそれらと整合している必要がある。

### clarification の将来像

たとえば worker が manager に質問する場合:

1. worker が thread に message を append する
2. manager への reply-needed が発生する
3. worker は `waiting` になる
4. scheduler が manager に reply work を dispatch する
5. manager の返答後に worker を再開する

この flow では notification だけでは不十分であり、
message / thread / reply semantics が必要になる。

したがって、この phase では:

- notification reaction を実装してよい
- ただし orchestration 全体を notification に還元しない

という立場を取る。

---

## meeting との関係

将来の meeting thread は、複数 agent が同じ thread を読み書きする shared deliberation になる。

このとき必要になるのは:

- participant set
- turn-taking policy
- reply / mention semantics
- meeting close / summarize condition

これらは次 phase 以降のテーマだが、scheduler の観点では:

- meeting も pending communicative work を生む
- ただし通常は non-preemptive に処理する

という形で接続される。

最初の meeting 実装は `manager-mediated` にするのが安全である。

---

## runtime と policy の分離

### Runtime mechanism

runtime の責務:

1. store を監視する
2. schedulable work を作る
3. agent state を見て queue / dispatch を決める
4. batching / debouncing する
5. agent run を起動する

### Agent policy

各 agent の責務:

- どの notification kind を購読するか
- どの task を引き受けるか
- notification を受けたとき何をするか
- message や reply request にどう応答するか

---

## 変更計画

### ファイル

- `packages/core/src/context-types.ts`
- `packages/core/src/context-store.ts`
- `packages/core/src/projection.ts`
- `packages/core/src/execution-engine.ts` または新しい scheduler module
- `packages/cli/src/index.ts`

### 変更

- agent runtime state の概念を追加
- pending work queue を追加
- notification subscription を pending work 生成ルールとして追加
- runtime scheduler loop を追加
- manager を最初の subscriber / consumer として登録
- internal orchestration thread を導入してもよい
- completed/failed task の result collection を自動化
- optional: reply-needed semantics への拡張余地を payload / API に残す

---

## 完了条件

- runtime scheduler が基本機構として説明・実装されている
- notification reaction は scheduler の一部として位置づけられている
- agent run が non-preemptive by default であると明示されている
- manager は最初の reactive consumer として動作する
- `task-completed` / `task-failed` notification をきっかけに internal run できる
- user input なしに result collection ができる
- user-facing thread を不必要に汚さない
- 将来的に reply / clarification / meeting へ一般化できる構造になっている

---

## 非 goals

この phase ではまだやらない:

- full clarification conversation threads
- reply-request の complete semantics
- multi-party meeting orchestration
- broadcast / stream の active scheduling
- semantic recall
- full summary memory system
- true parallel execution scheduler
- durable subscription persistence as context

---

## 次 phase との関係

この phaseの次には、notification だけでなく、
**双方向通信の意味論** を追加できる。

つまり将来的には:

- 06: async task semantics
- 07: runtime scheduler / non-preemptive reactions
- 08: bidirectional communication / clarifications
- 09: meeting threads / multi-party deliberation

という流れになる。

この順番により、まず runtime orchestration の scheduling semantics を固め、
その上で task とは別の sync communication を明示的に追加できる。
