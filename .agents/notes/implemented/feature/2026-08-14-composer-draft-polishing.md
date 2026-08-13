# Agent Note: Composer draft polishing

Status: implemented

English | [中文](2026-08-14-composer-draft-polishing.zh.md)

## Problem

Composer drafts could only be edited by hand: there was no model-backed rewriting that reads as a continuation of the conversation. Any such capability must not perturb the session — a rewrite of a not-yet-sent draft is a draft edit, not a conversation turn, so it must not be titled, checkpointed, or surfaced in the transcript, and it must not change the main conversation's context or KV cache. The context that grounds a rewrite must also be authoritative: the session's own log, not a snapshot assembled in the browser, which can be windowed or stale.

## Decision

**One new host package owns the capability.** `@deepseek-ai/dsh-polish` (`packages/interaction/polish`) mounts a Typert remote service exposing `polish/polish` — `polish(agent, draft, mode, signal)` — returning the rewritten text or an explicit failure (`draft-blank`, `input-too-large`, `no-route`, `empty-output`, `internal`). The base bundle registers the plugin with the required deployment policy (`maxSummaryChars` 2000, `maxRecentMessages` 20, `maxLineChars` 2000, `maxRecentChars` 8000, `maxInputBytes` 16384, `maxOutputTokens` 4096, `timeoutMs` 30000); `tsconfig.host.json` gains the project reference.

**Three rewrite modes, one wire contract.** `basic` tightens grammar and wording, `enhanced` restructures for stronger expression, and `expand` unfolds the draft using context-supported detail; unknown wire values fall back to `basic` before they can index the prompt table. The system prompt enforces the output contract (keep meaning, facts, structure, and language; return only plain text), and normalization trims whitespace, strips one optional code-fence wrapper, and rejects empty output.

**Context is assembled host-side from the session log.** `assembleContextLines` scans the session's own events: the newest `compaction/summary` checkpoint first (read through a structural projection — the package must not import `dsh-compaction-basic`), then the most recent user/assistant surface messages after that checkpoint, all bounded by the policy budgets. Tool rows, injected context, and textless messages contribute nothing. The browser ships only the draft and the mode.

**The auxiliary call rides the session's own model route.** The route resolves from the session's logged `request/header` (the live truth, following mid-session model switches) with the agent's creation options as fallback. The generation carries the new `purpose: 'polish'` (`GenerateOptions` extended from `'compaction' | 'session-title'`), which the DeepSeek adapter maps to disabled thinking like `session-title`. The call is capped by `maxOutputTokens`, bounded by a `timeoutMs` deadline (reason code `POLISH_TIMEOUT`), and cancelled through the browser request's `AbortSignal`.

**A polish never touches the session log.** Nothing is appended, so no title generation, checkpoint, or transcript entry occurs; the main conversation's context and KV cache are unaffected.

**The composer integrates the rewrite as a guarded draft mutation.** The injected `polish` slot on `ComposerBarInjected` ships the live draft and the chosen mode. The polish button opens a mode menu (the new ui-primitives `Menu` `fitWidth` prop keeps the card sized to its short option set) and shows a busy lock — the box is read-only with a fade that holds at least one full fade cycle (`POLISH_LOCK_MIN_MS` 1200). A newer run or an unmount aborts the in-flight call; a successful rewrite replaces the draft only while the user has not taken the box over, and arms a one-shot undo (`{ original, polished }`) revoked by any manual draft edit, a session switch, or a page reload.

## Alternatives considered

**Browser-framed context lines.** An earlier design had the composer frame recent transcript lines client-side and ship them with the draft. Rejected because a browser snapshot can be windowed or stale, while the session log is authoritative; the service assembles context from `agent.session.events` under the deployment budget.

**Treating a polish as a conversation turn.** Rejected: appending the rewrite to the session log would title, checkpoint, and surface it in the transcript, and would perturb the main conversation's context and cache.

**Streaming the rewrite, retry policy, or style presets.** Deferred: the first delivery is a single-shot wholesale replacement, listed as deferred work in the package README.

**Reusing an existing generation purpose for the thinking-disable mapping.** Rejected: a dedicated `purpose: 'polish'` keeps per-capability transport metadata and generation policy explicit instead of overloading `session-title` or `compaction`.

## Consequences

Auxiliary token spend accrues on the session's own model route, capped by `maxOutputTokens`; subsequent turns see no context or cache difference. The composer locks the box during a polish, replaces the draft only if the user has not taken over, and offers one-shot undo. Failures are explicit and displayable, including the bounded-input and no-route cases. The package is optional for compositions without the Web composer. Known limits: single-shot rewrite, a bounded context window (older history beyond the latest compaction summary is out of scope), and no server-side caching of the draft or assembled context.

## Related

This file is an internal decision record (Agent Note), not official documentation; it is never published to the docs site. User-facing documentation for the capability lives in the package README (`packages/interaction/polish/README.md`, bilingual), which owns the service contract and the model experience; this note records only the decision, its alternatives, and its consequences.
