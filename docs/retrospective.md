# Retrospective

This document captures the main lessons from the `termy` experiment and serves as a closing note for the project.

## Outcome

`termy` validated an important architectural direction:

- a **context model** can be designed independently from the runtime
- append-only context records are a good source of truth for coordination state
- task-based delegation is a more practical foundation than fully autonomous agent collaboration

The project did **not** prove that a notification-centric or fully self-directed multi-agent system is ready for reliable use in this form.
That is not a failure of the context model; it is mainly a reminder that **runtime policy and scheduling remain separate concerns**.

## What worked

### 1. Context-first modeling

Representing important coordination artifacts as contexts worked well.
Examples include:

- threads
- messages
- tasks
- task status changes
- task results
- notifications
- reply requests
- meeting turns and meeting state

This made the system easier to inspect, replay, persist, and reason about.

### 2. Separation between context model and runtime model

One of the clearest lessons from the project is:

> **context model and runtime model are different layers**

The context model describes facts and durable coordination records.
The runtime model decides:

- when to dispatch agents
- how to schedule work
- how to batch or debounce reactions
- whether work is blocking or non-blocking
- how to handle waiting, retries, and timeouts

This separation turned out to be useful and likely worth preserving in future work.

### 3. Task-first delegation

The most practical coordination primitive was not notification but **task delegation**.
A manager/worker structure with explicit task creation, status tracking, and result collection felt more reliable than trying to make all agents react autonomously to shared events.

In short:

- `task` is a strong primitive
- `notification` is a helpful secondary primitive
- scheduler/runtime behavior should not be hidden inside either one

## What did not fully land

### 1. Notification alone is not enough for orchestration

Notifications are useful for:

- lightweight state changes
- wake-up hints
- progress surfacing
- fan-in triggers

But they are not, by themselves, a sufficient foundation for rich multi-agent coordination.
They do not solve:

- ownership
- turn-taking
- conflict resolution
- lifecycle management
- scheduling policy

### 2. Fully autonomous multi-agent behavior is still far away

The original aspiration included more agent-to-agent behavior with isolated contexts and explicit sharing only through notifications, meetings, and other coordination records.

That direction still seems conceptually sound, but it remains difficult in practice because it requires more than a data model:

- runtime scheduling
- clear communication semantics
- safe interruption or non-preemptive queuing
- robust recovery and retry behavior
- policies for promotion from private to shared context

### 3. "Everything is context" needs refinement

A better formulation after this experiment is:

> **Everything important to coordination should be represented as context, but execution policy belongs to the runtime.**

That keeps the strengths of the original idea while avoiding overload on the context layer.

## What Pi runtime was missing for this experiment

Pi worked well as the execution substrate for a single capable agent run.
It was strong at:

- tool use
- coding-oriented file operations
- producing useful responses within one run

What it did not provide, at least for the architecture explored here, was a full multi-agent coordination runtime.
The missing pieces were mostly around orchestration rather than model capability:

- a long-lived scheduler / event loop
- explicit async task lifecycle semantics
- durable external coordination state as the primary source of truth
- scoped private/shared context management across multiple agents
- agent lifecycle management (`idle`, `running`, `waiting`, resume)
- first-class coordination primitives beyond ordinary conversation and tool use

In practice, this meant Pi was best used as the "mind" of each manager/worker run, while `termy` had to provide the coordination layer around it.
That distinction turned out to be useful:

> **Pi was good at agent execution; `termy` was trying to supply the missing coordination runtime.**

## Final assessment

This project should be considered a useful experiment with a clear result:

- the **context-first** approach is promising
- the **task/subagent** model is a practical foundation
- the **scheduler/runtime** must be treated as a first-class layer
- notifications are helpful, but they are not the whole system

## Closing note

The project is being paused/closed in its current form.
It remains a valuable reference for:

- context-first coordination modeling
- task-oriented multi-agent orchestration
- separating durable coordination state from runtime execution policy

If the ideas here are revisited later, the most promising next step would likely be:

1. keep the context model
2. keep task-first delegation
3. make runtime scheduling explicit
4. add limited, policy-driven reactive behavior on top
