/**
 * Auxiliary model-backed draft polishing for the composer bar: the browser
 * sends the live draft over the `polish/polish` Remote endpoint; this service
 * assembles the conversation context from the session's own log — the latest
 * compaction summary (the existing long-history condensate produced by
 * dsh-compaction-basic) prefixed over the most recent surface messages,
 * bounded by the deployment policy — frames everything, dispatches one
 * auxiliary generation on the session's own model route, and returns the
 * polished text for the composer to write back into the draft machine.
 *
 * The service never appends to the session log: a polish is a draft edit, not
 * a conversation turn, so nothing is titled, checkpointed, or surfaced.
 *
 * @module @deepseek-ai/dsh-polish
 */

import { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { deriveEventMessage, isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { BlockAssembler, createUserMessage, deepFreeze } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, FinishReason, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { deadline, MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'

export const name = 'polish'

/** Stable failure categories for one polish request. */
export type PolishFailureCode =
  | 'draft-blank'
  | 'input-too-large'
  | 'no-route'
  | 'empty-output'
  | 'internal'

/** The three rewrite modes the composer offers: basic grammar/word polish,
 *  enhanced restructure, and context-grounded expansion. */
export type PolishMode = 'basic' | 'enhanced' | 'expand'

/** One polish request result, explicit on both branches. */
export type PolishResult =
  | { readonly ok: true; readonly value: { readonly text: string } }
  | {
    readonly ok: false
    readonly error: {
      readonly code: PolishFailureCode
      readonly message: string
      readonly details: Readonly<Record<string, unknown>>
    }
  }

/** Context-assembly budgets for one polish request. */
export interface PolishContextLimits {
  /** Maximum characters of the compaction-summary prefix line. */
  readonly maxSummaryChars: number
  /** Maximum number of recent surface messages framed (newest kept). */
  readonly maxRecentMessages: number
  /** Maximum characters per recent message line. */
  readonly maxLineChars: number
  /** Total character budget for all recent message lines. */
  readonly maxRecentChars: number
}

/** Required deployment policy for the auxiliary polish call. */
export interface PolishConfig extends PolishContextLimits {
  /** Maximum UTF-8 bytes in the final JSON-framed user prompt. */
  readonly maxInputBytes: number
  /** Auxiliary generation output-token cap. */
  readonly maxOutputTokens: number
  /** End-to-end auxiliary request deadline in milliseconds. */
  readonly timeoutMs: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    polish: PolishService
  }
}

/** Capability-owned timeout reason code for auxiliary polish requests. */
export const POLISH_TIMEOUT_CODE = 'POLISH_TIMEOUT'

/** Shared instruction tail: output contract and the conversation framing. */
const OUTPUT_CONTRACT = [
  'Return ONLY the rewritten text itself: plain text, no quotes, no prefixes, no explanations, no Markdown code fences.',
].join('\n')

/** Reference-resolution rule shared by every mode. */
const RESOLVE_REFERENCES = [
  'Resolve references: replace vague references in the draft (such as "this", "that", "it", "the above", or pronouns) with the concrete thing they point to in the context. If a reference cannot be resolved from the context, keep it as-is.',
].join('\n')

/** Basic mode: tighten grammar and wording, resolve references, stay faithful. */
const BASIC_PROMPT = [
  'You are a writing assistant that polishes draft messages in an ongoing conversation.',
  'The draft is the user\'s next message; the conversation context shows what was just discussed.',
  'Polish the draft so it reads as a natural, clear continuation of the conversation:',
  `- ${RESOLVE_REFERENCES}`,
  '- Tighten wording and grammar, and reorder sentences when that makes the draft clearer, without changing facts, intent, or language.',
  '- Match the conversation\'s tone.',
  '- Do not add content the draft does not imply, and do not answer the draft as if it were a question.',
  OUTPUT_CONTRACT,
].join('\n')

/** Enhanced mode: restructure for noticeably stronger, sharper expression. */
const ENHANCED_PROMPT = [
  'You are a writing assistant that rewrites draft messages in an ongoing conversation for stronger expression.',
  'The draft is the user\'s next message; the conversation context shows what was just discussed.',
  'Rewrite the draft so it is noticeably clearer, more precise, and more forceful:',
  `- ${RESOLVE_REFERENCES}`,
  '- Restructure sentences and choose sharper wording to maximize clarity and impact, while keeping every fact, the intent, and the language of the draft.',
  '- Cut redundancy; make the message read like it was written by a careful human.',
  '- Match the conversation\'s tone.',
  '- Do not change facts, do not add content the draft does not imply, and do not answer the draft as if it were a question.',
  OUTPUT_CONTRACT,
].join('\n')

/** Expand mode: unfold the draft into a fuller message using context-supported detail. */
const EXPAND_PROMPT = [
  'You are a writing assistant that expands draft messages using the ongoing conversation\'s context.',
  'The draft is the user\'s next message; the conversation context shows what was just discussed.',
  'Expand the draft into a fuller, more informative message:',
  `- ${RESOLVE_REFERENCES}`,
  '- Unfold shorthand into complete expressions, and enrich the draft with detail the context supports or the draft implies, so the message stands on its own.',
  '- Keep every fact and the intent of the draft; do not invent facts, figures, or commitments that neither the draft nor the context supports.',
  '- Match the conversation\'s tone and language.',
  '- Do not answer the draft as if it were a question.',
  OUTPUT_CONTRACT,
].join('\n')

/** Mode-selectable system instruction. */
const SYSTEM_PROMPTS: Readonly<Record<PolishMode, string>> = {
  basic: BASIC_PROMPT,
  enhanced: ENHANCED_PROMPT,
  expand: EXPAND_PROMPT,
}

/** One optional code-fence wrapper some models add despite the instruction. */
const FENCE = /^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)(?:\r?\n)?```$/

/** Freeze the success branch. */
function success(text: string): PolishResult {
  return Object.freeze({ ok: true, value: Object.freeze({ text }) })
}

/** Freeze the failure branch with caller-supplied details. */
function failure(
  code: PolishFailureCode,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): PolishResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, message, details: Object.freeze(details) }),
  })
}

/** Join the text blocks of one content payload. */
function textOf(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/**
 * Assemble the conversation context for one polish request from the session's
 * own log: the newest compaction summary first (the existing long-history
 * condensate — reusing it costs no extra summarization), then the most recent
 * user/assistant surface messages after that checkpoint, newest last, all
 * bounded by the budget. Tool rows, injected context, and textless messages
 * contribute nothing; an empty log yields no context at all.
 *
 * The compaction checkpoint record is declared by dsh-compaction-basic, which
 * this package must not import, so the scan reads it through a structural
 * projection (only the summary text and seq are consumed).
 */
export function assembleContextLines(
  events: readonly SessionEvent[],
  limits: PolishContextLimits,
): readonly string[] {
  const lines: string[] = []
  let budget = 0
  // The compaction summary: scan backward for the newest one — later checkpoints
  // already fold earlier history, so a single prefix line carries it all, and
  // the messages it shadowed stay out of the recent window.
  let afterSeq = 0
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    const candidate = event as unknown as {
      readonly type?: unknown
      readonly seq?: number
      readonly data?: { readonly summary?: readonly ContentBlock[] }
    }
    if (candidate.type !== 'compaction/summary') continue
    const summary = candidate.data?.summary
    const text = summary === undefined ? '' : textOf(summary).trim()
    if (text !== '') {
      const prefix = `[Context summary] ${text.slice(0, limits.maxSummaryChars)}`
      lines.push(prefix)
      budget += prefix.length
    }
    afterSeq = candidate.seq ?? 0
    break
  }
  const recent: string[] = []
  for (const event of events) {
    if (event.seq <= afterSeq) continue // folded into the checkpoint above
    if (!isAppendSurfaceEvent(event)) continue
    const message = deriveEventMessage(event)
    if (message === null) continue
    if (message.role !== 'user' && message.role !== 'assistant') continue
    const text = textOf(message.content).trim()
    if (text === '') continue
    recent.push(`${message.role === 'user' ? 'User' : 'Assistant'}: ${text}`)
  }
  for (const line of recent.slice(-limits.maxRecentMessages)) {
    const clipped = line.length > limits.maxLineChars
      ? `${line.slice(0, limits.maxLineChars)}…`
      : line
    if (budget + clipped.length > limits.maxRecentChars) break
    lines.push(clipped)
    budget += clipped.length
  }
  return lines
}

/** Detach the model's raw output into the polished text, or undefined when empty. */
export function normalizePolished(raw: string): string | undefined {
  let text = raw.trim()
  const fenced = FENCE.exec(text)
  if (fenced !== null && fenced[1] !== undefined) text = fenced[1].trim()
  return text.length === 0 ? undefined : text
}

/** Translate terminal finish reasons into a polish failure. */
function finishFailure(finish: FinishReason): PolishResult | undefined {
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'max-tokens':
      return failure('internal', 'polish output reached maxOutputTokens')
    case 'tool-calls':
      return failure('internal', 'polish model unexpectedly requested a tool')
    case 'error':
    case 'aborted':
      return failure('internal', finish.failure.message)
    default:
      return failure('internal', `polish model finished with unknown reason "${String((finish as { kind?: unknown }).kind)}"`)
  }
}

/**
 * Model-backed draft polishing service, exposed to the browser through the
 * `polish/polish` Remote endpoint (agent identity resolved by the Host
 * lookup; the draft travels as the only JSON parameter — the context is
 * assembled Host-side from the session log, which is authoritative and never
 * windowed by the browser).
 */
export class PolishService extends TypertRemoteService {
  static inject = ['llm']

  /** Loader validation for the required auxiliary-call policy. */
  static Config: s<PolishConfig> = s.object({
    maxSummaryChars: s.number().step(1).min(1).required(),
    maxRecentMessages: s.number().step(1).min(1).required(),
    maxLineChars: s.number().step(1).min(1).required(),
    maxRecentChars: s.number().step(1).min(1).required(),
    maxInputBytes: s.number().step(1).min(1).required(),
    maxOutputTokens: s.number().step(1).min(1).required(),
    timeoutMs: s.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).required(),
  })

  /**
   * @param ctx - Host context carrying the LLM service.
   * @param config - Required auxiliary-call policy.
   */
  constructor(ctx: Context, private readonly config: PolishConfig) {
    super(ctx, 'polish')
  }

  /**
   * Polish one draft message against the session's own conversation context.
   * @param agent - exact receiving agent (resolved by the Host lookup).
   * @param draft - draft text to polish, sent verbatim.
   * @param mode - rewrite mode: basic grammar/word polish, enhanced
   *   restructure, or context-grounded expansion. Unknown modes fall back to
   *   basic.
   * @param signal - cancellation owned by the browser request.
   * @returns the polished text or an explicit failure.
   */
  @Remote('polish')
  async polish(
    agent: Agent,
    draft: string,
    mode: PolishMode,
    signal: AbortSignal,
  ): Promise<PolishResult> {
    signal.throwIfAborted()
    const trimmed = draft.trim()
    if (trimmed.length === 0) {
      return failure('draft-blank', 'polish requires a non-blank draft')
    }
    // The context is the session's own history: the latest compaction summary
    // plus the most recent surface messages, assembled here under the policy
    // budget (the browser never ships context — its snapshot could be windowed
    // or stale, while the log is authoritative).
    const context = assembleContextLines(agent.session.events, this.config)
    // JSON framing so draft/context text cannot break structural delimiters.
    const framed = JSON.stringify({ context, draft: trimmed })
    const actualBytes = Buffer.byteLength(framed, 'utf8')
    if (actualBytes > this.config.maxInputBytes) {
      return failure(
        'input-too-large',
        `polish input is ${actualBytes} bytes, exceeding maxInputBytes ${this.config.maxInputBytes}`,
        { maxBytes: this.config.maxInputBytes, actualBytes },
      )
    }
    const route = this.resolveRoute(agent)
    if (route === undefined) {
      return failure('no-route', 'no model route is available for this session; select a model first')
    }
    // The mode arrives over the wire and is not trusted: unknown values fall
    // back to basic before they can index the prompt table.
    const resolvedMode: PolishMode = mode === 'enhanced' || mode === 'expand' ? mode : 'basic'
    const messages: Message[] = [createUserMessage({
      content: [{ type: 'text', text: framed }],
      source: { kind: 'plugin', plugin: 'dsh-polish' },
    })]
    using callDeadline = deadline(signal, this.config.timeoutMs, POLISH_TIMEOUT_CODE)
    const options: GenerateOptions = deepFreeze({
      provider: route.provider,
      model: route.model,
      messages,
      system: SYSTEM_PROMPTS[resolvedMode],
      maxTokens: this.config.maxOutputTokens,
      sessionId: agent.session.id,
      purpose: 'polish',
      signal: callDeadline.signal,
    })
    const assembler = new BlockAssembler()
    try {
      for await (const chunk of this.ctx.llm.stream(options)) {
        assembler.push(chunk)
      }
    } catch (error) {
      return failure('internal', error instanceof Error ? error.message : String(error))
    }
    signal.throwIfAborted()
    const terminalFailure = finishFailure(assembler.finish)
    if (terminalFailure !== undefined) return terminalFailure
    const blocks = assembler.blocks()
    const text = normalizePolished(blocks
      .filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join(' '))
    if (text === undefined) {
      return failure('empty-output', 'polish model produced no text')
    }
    return success(text)
  }

  /**
   * Resolve the auxiliary route: the session's logged request header is the
   * live truth (it follows mid-session model switches); the agent's creation
   * options are the fallback for sessions that never made a request.
   */
  private resolveRoute(agent: Agent): { readonly provider: string; readonly model: string } | undefined {
    const header = agent.session.requestHeader()
    if (header !== undefined && header.config.provider !== '' && header.config.model !== '') {
      return { provider: header.config.provider, model: header.config.model }
    }
    const options = agent.options
    if (options.provider !== undefined && options.model !== undefined) {
      return { provider: options.provider, model: options.model }
    }
    return undefined
  }
}

export default PolishService
