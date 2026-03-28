import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  createContextId,
  createContextStore,
  createJsonlContextJournal,
  ensureAgentContext,
  ensureThreadContext,
  ensureUserContext,
} from "@termy/core";

export type CliBootstrap = {
  sessionId: string;
  sessionPath: string;
  store: ReturnType<typeof createContextStore>;
  thread: ReturnType<typeof ensureThreadContext>;
  user: ReturnType<typeof ensureUserContext>;
  manager: ReturnType<typeof ensureAgentContext>;
  worker: ReturnType<typeof ensureAgentContext>;
};

export function bootstrapCliSession(cwd: string): CliBootstrap {
  const sessionId = createContextId();
  const sessionPath = join(cwd, ".termy", "sessions", `${sessionId}.jsonl`);
  mkdirSync(dirname(sessionPath), { recursive: true });

  const journal = createJsonlContextJournal(sessionPath);
  const store = createContextStore([], { journal });

  const thread = ensureThreadContext({
    store,
    key: "main",
    name: "main",
  });
  const user = ensureUserContext({
    store,
    key: "cli",
    name: "cli",
  });
  const manager = ensureAgentContext({
    store,
    key: "manager",
    name: "manager",
    role: "manager",
  });
  const worker = ensureAgentContext({
    store,
    key: "worker:reader",
    name: "reader",
    role: "worker",
  });

  return {
    sessionId,
    sessionPath,
    store,
    thread,
    user,
    manager,
    worker,
  };
}
