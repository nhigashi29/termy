import type { AnyContext } from "./context-types.js";

export interface ContextJournal {
  append(context: AnyContext): void;
  appendMany(contexts: AnyContext[]): void;
}
