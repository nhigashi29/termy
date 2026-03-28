# 02 Manager Direct Response

01 で最小マルチエージェント協調ループが動いた。
しかし今の CLI は全入力を worker に委譲している。「こんにちは」にも task が作られる。

このプランでは **manager を会話のデフォルト応答者に戻し、委譲を意図的な行為にする**。

See also:

- [`01_minimal-multi-agent-plan.md`](01_minimal-multi-agent-plan.md)
- [`goal-architecture.md`](goal-architecture.md)

---

## 問題

今のフロー:

1. ユーザー入力
2. **必ず** task を作成して worker に委譲
3. worker 実行
4. manager が結果を合成して応答

これはゴールアーキテクチャと矛盾する:

> manager は orchestrator であり、ユーザーの意図を解釈し、**必要な時だけ** 委譲する

---

## ゴール

ユーザー入力に対して **manager が直接応答する** のをデフォルトにする。
委譲は manager が明示的に選択した時だけ発生する。

---

## 設計方針

### Phase 1 — Manager 直接応答に戻す

CLI のフローを変更:

1. ユーザー入力 → manager conversation に直接送る
2. manager が応答を返す

task 作成・engine.tick() のハードコード委譲を外す。
execution engine のコードは残すが、CLI のメインループからは呼ばない。

### Phase 2 — Task 作成を manager の tool として公開する

manager に `create_task` tool を追加する。
manager が「これは委譲すべき」と判断した時に tool call として task を作成する。

```ts
// tool definition
{
  name: "create_task",
  description: "Delegate work to a worker agent",
  inputSchema: {
    type: "object",
    properties: {
      instruction: { type: "string" },
      title: { type: "string" },
    },
    required: ["instruction"],
  },
}
```

tool の実行:
1. `create_task` tool call を検知
2. Task context を append
3. `engine.tick()` を実行
4. TaskResult を tool result として manager に返す

### Phase 3 — Manager に role-specific system prompt を与える

manager が委譲判断をするために、system prompt で役割を伝える:

- あなたは manager です
- 単純な会話には直接答えてください
- ファイル操作や調査が必要な場合は `create_task` で worker に委譲してください
- worker の結果を受け取ったら、ユーザー向けに整理して回答してください

---

## スコープ

### In scope

- CLI のメインループを manager 直接応答に変更
- `create_task` tool の定義と実行ハンドリング
- manager 用 system prompt
- engine.tick() を tool 実行フロー内で呼ぶ

### Out of scope

- 複数 worker の動的選択
- worker 種別の自動ルーティング
- Channel / Notification
- Recall tools

---

## ファイル変更計画

### `packages/cli/src/index.ts`

- メインループ: task 作成のハードコードを外し、`managerConversation.sendUserMessage(line)` に戻す
- `create_task` tool の実行ハンドリングを追加

### `packages/cli/src/pi-sdk-runtime.ts` (または新しい設定ファイル)

- manager 用 tool に `create_task` を追加
- system prompt に manager の role を記述

### `packages/core/src/execution-engine.ts`

- 変更なし（既存のまま使える）

---

## 完了条件

- 「こんにちは」→ manager が直接応答（task が作られない）
- 「README.md を要約して」→ manager が `create_task` を呼び、worker が実行、manager が結果を合成
- すべてがコンテキストログに記録される
