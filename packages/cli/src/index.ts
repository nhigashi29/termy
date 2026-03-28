#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  createContextStore,
  createConversation,
  createJsonlContextJournal,
  loadContextsFromJsonl,
} from "@termy/core";

import { createPiSdkRuntime } from "./pi-sdk-runtime.js";

async function main(): Promise<void> {
  console.log("[cli] booting @termy/cli");

  const threadId = "thread:main";
  const sessionPath = join(process.cwd(), ".termy", "sessions", "main.jsonl");
  mkdirSync(dirname(sessionPath), { recursive: true });

  const runtime = await createPiSdkRuntime();
  const existingContexts = loadContextsFromJsonl(sessionPath);
  const store = createContextStore(existingContexts);
  const journal = createJsonlContextJournal(sessionPath);
  const conversation = createConversation({
    store,
    runtime,
    threadId,
    userId: "user:cli",
    agentId: "agent:pi",
    journal,
  });
  const rl = readline.createInterface({ input, output });

  console.log(`termy ready. session: ${sessionPath}. type 'exit' to quit.`);
  console.log(`[cli] restored contexts: ${existingContexts.length}`);

  while (true) {
    const line = (await rl.question("> ")).trim();

    if (!line) {
      continue;
    }

    if (line === "exit") {
      console.log("bye");
      break;
    }

    console.log(`[cli] appending user message to ${conversation.threadId}: ${line}`);

    let streamed = "";
    const result = await conversation.sendUserMessage(line, {
      onTextDelta(delta) {
        streamed += delta;
      },
    });

    console.log(result.payload.text);
    console.log(`[cli] thread contexts: ${conversation.listThread().length}`);
    console.log(`[cli] persisted to ${sessionPath}`);

    void streamed;
  }

  rl.close();
}

main().catch((error: unknown) => {
  console.error("[cli] fatal error", error);
  process.exit(1);
});
