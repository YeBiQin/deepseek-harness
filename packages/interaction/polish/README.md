# @deepseek-ai/dsh-polish

English | [中文](README.zh.md)

Auxiliary model-backed draft polishing for the composer bar. The browser sends the live draft and the chosen mode over the `polish/polish` Remote endpoint; this service assembles the conversation context host-side from the session's own log (the latest compaction summary plus the most recent surface messages, bounded by the deployment policy), frames everything, dispatches one auxiliary generation on the session's own model route, and returns the polished text for the composer to write back into the draft machine. A polish is a draft edit, never a conversation turn: the service does not append to the session log, so nothing is titled, checkpointed, or surfaced in the transcript.

## Service contract

`ctx.polish.polish(agent, draft, mode, signal)` returns `{ ok: true, value: { text } }` with the polished text, or `{ ok: false, error: { code, message, details } }` with an explicit failure:

- `draft-blank` — the trimmed draft is empty.
- `input-too-large` — the JSON-framed input exceeds `maxInputBytes`.
- `no-route` — the session has neither a logged request header nor agent creation options naming a provider/model.
- `empty-output` — the model produced no text after normalization.
- `internal` — stream, finish-reason, or timeout failures (deadline code `POLISH_TIMEOUT`).

The auxiliary route resolves from the session's logged `request/header` (the live truth, following mid-session model switches) with the agent's creation options as fallback. The call is bounded by the required `maxInputBytes`, `maxOutputTokens`, and `timeoutMs` deployment policy; the browser request's `AbortSignal` cancels the generation.

The output contract is enforced by the system prompt (keep meaning, facts, structure, and language; return only the plain polished text) plus normalization: surrounding whitespace is trimmed, one optional code-fence wrapper is stripped, and an empty result is rejected.

## Composition

The shipped `dsh` base mounts this service; the Web composer's polish button calls it through the shared `/api` RPC channel. Compositions without the Web composer do not need this package.

## Model Experience

### What the model sees

One auxiliary user message containing the JSON-framed context lines and draft, under the fixed polish system instruction. The request carries `purpose: 'polish'`, which the DeepSeek adapter maps to disabled thinking. Nothing from this call enters the session log or the conversation's model history.

### Token effect

Auxiliary call tokens on the session's own model route, capped by `maxOutputTokens`. The call does not change the conversation's context, so subsequent turns see no token or cache difference beyond the auxiliary request itself.

### KV Cache effect

The auxiliary request is not part of the conversation history and does not affect the main conversation's cache. The draft arrives from the browser and the assembled context derives from the session log; neither is cached server-side.

## Known Limitations and Deferred Work

- **Bounded context window** — the assembled context is capped by `maxSummaryChars`, `maxRecentMessages`, `maxLineChars`, and `maxRecentChars`; history older than the latest compaction summary is out of scope for a rewrite.
- **Single-shot rewrite** — no streaming to the browser, retry policy, or style presets; the draft is replaced wholesale on success.
