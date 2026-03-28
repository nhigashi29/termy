# Context Control Plane

This document describes a missing layer in many agent systems: a **control plane for context**.

It is a design note for the intended direction of `termy`, not a claim that all of this exists today.

See also:

- [`../context-model.md`](../context-model.md)
- [`goal-architecture.md`](goal-architecture.md)
- [`multi-agent.md`](multi-agent.md)

---

## Thesis

In practice, agent execution is mostly **context manipulation**.

Agents do not only process messages. They operate on a broader working set that includes:

- system instructions
- user requests
- prior messages
- tool definitions
- tool call history
- tool results
- tasks
- notifications
- summaries
- retrieved memories
- artifact references
- other agents' outputs

If that is true, then context should not be treated as an accidental byproduct of prompting.
It should be treated as a **first-class, controllable runtime substrate**.

In short:

> **if context is the real substrate of agent execution, then context must be explicitly modeled, queryable, controllable, and observable**

---

## Problem statement

Many current agent systems split important runtime information into separate buckets:

- `messages`
- `tools`
- `memory`
- `state`
- `logs`
- `tasks`

These are often modeled as different subsystems because of API shape or implementation convenience.
But from the point of view of the running agent, they are all part of the same decision context.

This mismatch creates several problems:

- it is hard to explain why a specific piece of context was included in a run
- it is hard to see what information influenced an output
- tool execution history becomes a side channel instead of part of the reasoning trace
- memory retrieval feels bolted on instead of native to the runtime
- multi-agent coordination becomes ad-hoc because shared and private context are not modeled uniformly

The result is that the system may have prompt assembly, tool execution, and storage, but still lack a real **context control plane**.

---

## What is a context control plane?

A context control plane is the layer that governs:

- what context exists
- how context is represented
- who can see which context
- how context is selected for a run
- how old context is compressed or summarized
- how context is retrieved back into the working set
- how context relationships are inspected and traced

This is broader than prompt construction.
It is closer to a runtime architecture for memory, coordination, and visibility.

---

## Why prompt-centric systems are not enough

A prompt-centric design tends to treat the prompt as the main unit of computation.
That works reasonably well for single-agent loops.

But in multi-agent systems the prompt is only a temporary projection over a much larger state space.
The durable unit is not the prompt string. The durable unit is the recorded context.

This leads to a different architectural view:

- **Context store** = source of truth
- **Projection** = run-specific working view
- **Recall** = mechanism for bringing older context back into scope
- **Summaries** = compressed views over prior contexts
- **Tasks and notifications** = structured coordination contexts

From this perspective, a prompt is a rendering of context, not the primary system model.

---

## Context model and context operations

A useful context-first runtime needs both:

1. a **context model**
2. a set of **context operations**

### Context model

The model defines the kinds of things the system stores, for example:

- `Agent`
- `User`
- `System`
- `Channel`
- `Thread`
- `Message`
- `Task`
- `TaskStatusChange`
- `TaskResult`
- `Notification`
- `ToolCall`
- `ToolResult`
- `Summary`
- `ArtifactReference`
- future decision / subscription / spawn lifecycle contexts

### Context operations

The operations define how the runtime works with that data, for example:

- append
- list / filter
- project
- retrieve
- summarize
- subscribe
- rank
- compress
- link
- trace provenance
- hide / reveal based on visibility rules

Without both layers, "everything is context" remains only a modeling slogan.

---

## Control-plane responsibilities

A future `termy`-style context control plane should cover at least five responsibilities.

### 1. Storage

Maintain append-only, replayable context records.

Requirements:

- immutable event history
- stable ids
- durable journaling
- linked records where useful
- provenance via `createdBy` and related references

### 2. Projection

Construct the working context for a specific run.

Examples:

- thread view for a user-facing conversation
- task-scoped view for a worker agent
- manager overview across multiple threads
- summary-first view for long-running work
- filtered view that hides private contexts

Projection should be explicit and inspectable.

### 3. Retrieval

Bring older or non-local context back into scope when needed.

Examples:

- keyword search
- structural search by thread/channel/task/agent
- semantic search
- neighborhood lookup around a context id
- timeline retrieval
- summary-first recall before raw expansion

Retrieval is not an optional plugin. In long-running systems it is part of normal execution.

### 4. Governance

Control visibility, retention, and compression.

Examples:

- private vs shared contexts
- retention classes such as `ephemeral`, `working`, `durable`, `index-only`
- automatic summary generation
- redaction and access control
- projection policies per agent role

### 5. Observability

Explain what happened and why.

Examples:

- why this context was included in a run
- which contexts influenced an answer
- which contexts were omitted
- which agent saw which projection
- how a result traces back to prior tasks, tools, or messages

This is especially important for debugging and multi-agent coordination.

---

## Context tools

If code has tools like `read`, `edit`, and `grep`, a context-first runtime should eventually expose equivalent context tools.

Examples of useful future tools:

- `context list`
- `context find`
- `context around`
- `context summarize`
- `context timeline`
- `context explain`
- `context project`
- `context pin`
- `context forget`
- `context subscribe`

These tools make context operational, not just stored.

---

## Relationship to multi-agent coordination

Multi-agent systems increase the need for a context control plane because they introduce:

- shared context
- private context
- delegated work
- notifications
- parallel work streams
- partial and role-specific visibility
- long-running state that no single agent can keep in prompt memory

In this setting, the main problem is not only message passing.
It is deciding:

- which agent should see what
- which context should remain local vs shared
- how work state is represented
- how previous decisions are recalled
- how context is compacted over time without losing important information

That is why multi-agent coordination is better viewed as a context architecture problem than a pure chat or tool-calling problem.

---

## Agent as a context-defined actor

A stronger and more precise extension of the context-first idea is to treat agents as **context-defined actors**, while keeping execution itself as a runtime concern.

In that view, the first-class contexts are not necessarily a single `Agent` object. Instead they are the durable facts and lifecycle records that describe an agent, such as:

- `AgentDefinition`
- capabilities
- spawn / activation requests
- task ownership and delegation relationships
- subscriptions and participation
- run / activation status events

This enables a uniform model for:

- manager → worker delegation
- subagent creation or activation
- agent-to-agent notifications
- capability-aware routing
- replayable agent topology and lifecycle

Under this model, **agent execution is runtime, not context**.
The execution engine remains imperative code, while agent definitions, capabilities, and lifecycle records live in the context space and can be observed, replayed, queried, and projected like everything else.

---

## Working context vs stored history

A context control plane should explicitly separate:

### Working context

The bounded context sent into one run.

Examples:

- role instructions
- assigned task
- recent thread contexts
- recent notifications
- relevant summaries
- selected tool results

### Stored history

The full append-only context log.
This may become large and should not be loaded in full for every run.

### Recall path

The mechanism by which an agent asks for more context when needed.
This is where tools like `context find` matter.

This three-part split helps keep prompt usage bounded without giving up durable history.

---

## Context as operating substrate

One useful mental model is to treat the runtime like an operating system for contexts.

Approximate analogy:

- `ContextStore` = durable process-visible state
- projection = working set
- tasks = schedulable work units
- notifications = interrupts or events
- summaries = compaction
- retrieval = paging / recall
- execution engine = scheduler

This analogy is imperfect, but it highlights the intended direction:
`termy` should not only run prompts. It should manage contexts.

---

## Non-goals

A context control plane does **not** mean:

- every context must always be loaded
- every interaction must be represented as a message
- the execution engine itself must become a context
- raw context should always be shown instead of summaries
- context modeling alone removes the need for good prompting

The goal is not to eliminate runtime logic.
The goal is to make context a first-class, governable part of runtime logic.

---

## Implications for `termy`

If `termy` moves in this direction, then future work likely includes:

- richer context types for tasks, notifications, summaries, and agent lifecycle
- projection APIs that are explicit and testable
- recall tools such as `context find`
- observability tools for explaining projections and influence
- visibility and retention policies
- execution-engine integration with context subscriptions

This would move `termy` from a conversation-oriented runtime toward a more general context-oriented agent substrate.

---

## Summary

The core claim of this document is simple:

> **Agent systems already run on context, but most of them lack a proper control plane for it.**

A context-first system should therefore treat context as:

- modeled
- durable
- queryable
- recallable
- governable
- observable

That is the missing systems layer this design aims to explore.
