#!/usr/bin/env node
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createAgent } from "@termy/core";

async function main(): Promise<void> {
  console.log("[cli] booting @termy/cli");

  const agent = createAgent({ name: "termy-dev" });
  const rl = readline.createInterface({ input, output });

  console.log("termy ready. type 'exit' to quit.");

  while (true) {
    const line = (await rl.question("> ")).trim();

    if (!line) {
      continue;
    }

    if (line === "exit") {
      console.log("bye");
      break;
    }

    console.log(`[cli] forwarding to core: ${line}`);
    const result = await agent.run(line);
    console.log(result);
  }

  rl.close();
}

main().catch((error: unknown) => {
  console.error("[cli] fatal error", error);
  process.exit(1);
});
