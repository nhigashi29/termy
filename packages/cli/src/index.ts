#!/usr/bin/env node
import { bootstrapCliSession } from "./bootstrap.js";
import { formatBackgroundEvent } from "./background-events.js";
import { runCliRepl } from "./repl.js";
import { setupCliRuntime } from "./runtime-setup.js";

async function main(): Promise<void> {
  console.log("[cli] booting @termy/cli");

  const session = bootstrapCliSession(process.cwd());
  const { managerAgent, engine } = await setupCliRuntime({
    store: session.store,
    threadId: session.thread.id,
    managerId: session.manager.id,
    workerId: session.worker.id,
  });

  const stopEngine = engine.start();
  const stopBackgroundLog = session.store.subscribe((context) => {
    const line = formatBackgroundEvent(session.store, context);
    if (!line) return;
    console.log(line);
  });

  try {
    await runCliRepl({
      store: session.store,
      threadId: session.thread.id,
      userId: session.user.id,
      managerId: session.manager.id,
      managerAgent,
      sessionPath: session.sessionPath,
      sessionId: session.sessionId,
    });
  } finally {
    stopBackgroundLog();
    stopEngine();
  }
}

main().catch((error: unknown) => {
  console.error("[cli] fatal error", error);
  process.exit(1);
});
