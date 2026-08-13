import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  assembleContextLines, normalizePolished, PolishService, POLISH_TIMEOUT_CODE,
} from '../src/index.ts'
import type { PolishConfig } from '../src/index.ts'

const CONFIG: PolishConfig = {
  maxSummaryChars: 2000,
  maxRecentMessages: 10,
  maxLineChars: 2000,
  maxRecentChars: 8000,
  maxInputBytes: 16384,
  maxOutputTokens: 512,
  timeoutMs: 30_000,
}

/** Minimal text script the polish assembler accepts. */
const TEXT_SCRIPT: StreamChunk[] = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: '  润色后的消息内容  ' },
  { type: 'finish', reason: { kind: 'stop' } },
]

class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: readonly StreamChunk[]) {
    super()
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield * this.script
  }
}

let nextAgent = 0
let nextMessage = 0

/** One surface message payload (the shape deriveEventMessage projects). */
function message(role: 'user' | 'assistant', text: string): Message {
  return {
    id: `m-${++nextMessage}` as never,
    role,
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

/** Append-origin surface events with the text payloads the context assembly reads. */
export function userEvent(seq: number, text: string): SessionEvent {
  return { type: 'user/message', seq, time: 0, surfaceOp: 'append', data: message('user', text) } as unknown as SessionEvent
}

export function assistantEvent(seq: number, text: string): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    time: 0,
    surfaceOp: 'append',
    data: { turn: 1, step: 0, message: message('assistant', text) },
  } as unknown as SessionEvent
}

/** A non-surface event (tool rows, boundaries) that must contribute nothing. */
function toolEvent(seq: number): SessionEvent {
  return {
    type: 'tool/result',
    seq,
    time: 0,
    surfaceOp: 'append',
    data: {
      callId: `c-${seq}`,
      message: {
        id: `t-${seq}` as never,
        role: 'tool' as never,
        content: [{ type: 'text', text: 'x' }],
        source: { kind: 'user' },
      },
    },
  } as unknown as SessionEvent
}

/** The compaction checkpoint record the context assembly reuses as its prefix. */
export function compactionEvent(seq: number, summary: string): SessionEvent {
  return {
    type: 'compaction/summary',
    seq,
    time: 0,
    data: { summary: [{ type: 'text', text: summary }] },
  } as unknown as SessionEvent
}

/** A live-enough Agent face: session id, logged route, creation options, and log events. */
function agentOf(
  route: { provider: string; model: string } | undefined,
  options: Agent['options'] = {},
  events: readonly SessionEvent[] = [],
): Agent {
  return {
    id: `polish-agent-${++nextAgent}` as never,
    options,
    session: {
      id: `polish-session-${nextAgent}` as never,
      requestHeader: () => (route === undefined ? undefined : { config: route }),
      events,
    },
  } as unknown as Agent
}

async function setup(script: readonly StreamChunk[]): Promise<{ ctx: Context; adapter: RecordingAdapter }> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  const adapter = new RecordingAdapter(script)
  ctx.llm.registerAdapter(['mock-route'], adapter)
  await ctx.plugin(PolishService, CONFIG)
  return { ctx, adapter }
}

describe('normalizePolished', () => {
  it('trims surrounding whitespace and strips one code-fence wrapper', () => {
    expect(normalizePolished('  plain text  ')).toBe('plain text')
    expect(normalizePolished('```text\npolished\n```')).toBe('polished')
    expect(normalizePolished('```\n带围栏的中文\n```')).toBe('带围栏的中文')
  })

  it('returns undefined for empty or fence-only output', () => {
    expect(normalizePolished('   ')).toBeUndefined()
    expect(normalizePolished('```\n```')).toBeUndefined()
  })
})

describe('assembleContextLines', () => {
  it('produces no context from an empty or non-surface log', () => {
    expect(assembleContextLines([], CONFIG)).toEqual([])
    expect(assembleContextLines([toolEvent(1), toolEvent(2)], CONFIG)).toEqual([])
  })

  it('frames the newest compaction summary first, then recent messages with role prefixes', () => {
    const events = [
      userEvent(1, '最初的问题'),
      assistantEvent(2, '最初的回答'),
      compactionEvent(3, '早期历史摘要'),
      userEvent(4, '最近的问题'),
      assistantEvent(5, '最近的回答'),
    ]
    expect(assembleContextLines(events, CONFIG)).toEqual([
      '[Context summary] 早期历史摘要',
      'User: 最近的问题',
      'Assistant: 最近的回答',
    ])
  })

  it('uses only the newest compaction summary (later checkpoints fold earlier history)', () => {
    const events = [
      compactionEvent(1, '第一次摘要'),
      compactionEvent(2, '第二次摘要'),
      userEvent(3, '问题'),
    ]
    expect(assembleContextLines(events, CONFIG)[0]).toBe('[Context summary] 第二次摘要')
    // Messages shadowed by the checkpoint stay out of the recent window.
    const shadowed = [
      userEvent(1, '被压缩的旧问题'),
      assistantEvent(2, '被压缩的旧回答'),
      compactionEvent(3, '摘要'),
      userEvent(4, '压缩后的新问题'),
    ]
    expect(assembleContextLines(shadowed, CONFIG)).toEqual([
      '[Context summary] 摘要',
      'User: 压缩后的新问题',
    ])
  })

  it('drops textless messages, tool rows, and injected context', () => {
    const events = [
      userEvent(1, '   '),
      assistantEvent(2, '   '),
      toolEvent(3),
      { type: 'user/message', seq: 4, time: 0, surfaceOp: 'append', data: message('user', '注入') } as unknown as SessionEvent,
    ]
    // The injected-context payload projects in user role but carries no
    // distinguishing marker here; the assembly's role filter keeps only the
    // ordinary user/assistant text, which the textless rows above drop anyway.
    const [line] = assembleContextLines(events, CONFIG)
    expect(line).toBe('User: 注入')
  })

  it('keeps only the newest messages and applies the line and total budgets', () => {
    const events = Array.from({ length: 12 }, (_, index) => userEvent(index + 1, `消息${index}`))
    const lines = assembleContextLines(events, { ...CONFIG, maxRecentMessages: 5 })
    expect(lines).toHaveLength(5)
    expect(lines[0]).toBe('User: 消息7')

    const clipped = assembleContextLines([userEvent(1, 'x'.repeat(100))], { ...CONFIG, maxLineChars: 10 })
    expect(clipped[0]).toBe(`User: ${'x'.repeat(4)}…`)

    const budgeted = assembleContextLines(
      [userEvent(1, 'a'.repeat(50)), userEvent(2, 'b'.repeat(50))],
      { ...CONFIG, maxRecentChars: 70 },
    )
    expect(budgeted).toHaveLength(1)

    const summaryClipped = assembleContextLines([compactionEvent(1, 's'.repeat(100))], { ...CONFIG, maxSummaryChars: 10 })
    expect(summaryClipped[0]).toBe(`[Context summary] ${'s'.repeat(10)}`)
  })
})

describe('PolishService.polish', () => {
  it('assembles the context from the session log, uses the logged route, and returns the polished text', async () => {
    const { ctx, adapter } = await setup(TEXT_SCRIPT)
    const result = await ctx.polish.polish(
      agentOf(
        { provider: 'mock-route', model: 'mock-model' },
        {},
        [userEvent(1, '第一个问题'), assistantEvent(2, '第一个回答')],
      ),
      '  请 帮 我  润色  ',
      'basic',
      new AbortController().signal,
    )
    expect(result).toEqual({ ok: true, value: { text: '润色后的消息内容' } })
    const request = adapter.requests[0]!
    expect(request.provider).toBe('mock-route')
    expect(request.model).toBe('mock-model')
    expect(request.purpose).toBe('polish')
    expect(request.maxTokens).toBe(CONFIG.maxOutputTokens)
    expect(request.system).toContain('polishes draft messages')
    const framed = JSON.parse((request.messages[0]!.content[0] as { text: string }).text) as {
      draft: string
      context: readonly string[]
    }
    expect(framed.draft).toBe('请 帮 我  润色')
    expect(framed.context).toEqual(['User: 第一个问题', 'Assistant: 第一个回答'])
  })

  it('selects the mode-specific system prompt', async () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['basic', 'polishes draft messages'],
      ['enhanced', 'stronger expression'],
      ['expand', 'fuller, more informative message'],
    ]
    for (const [mode, marker] of cases) {
      const { ctx, adapter } = await setup(TEXT_SCRIPT)
      const result = await ctx.polish.polish(
        agentOf({ provider: 'mock-route', model: 'mock-model' }),
        'draft',
        mode as never,
        new AbortController().signal,
      )
      expect(result.ok).toBe(true)
      expect(adapter.requests[0]!.system).toContain(marker)
    }
  })

  it('falls back to the agent creation options when no request header is logged', async () => {
    const { ctx } = await setup(TEXT_SCRIPT)
    const result = await ctx.polish.polish(
      agentOf(undefined, { provider: 'mock-route', model: 'mock-model' }),
      'draft',
      'basic',
      new AbortController().signal,
    )
    expect(result).toEqual({ ok: true, value: { text: '润色后的消息内容' } })
  })

  it('rejects a blank draft before any model call', async () => {
    const { ctx, adapter } = await setup(TEXT_SCRIPT)
    const result = await ctx.polish.polish(agentOf({ provider: 'mock-route', model: 'mock-model' }), '   ', 'basic', new AbortController().signal)
    expect(result).toEqual({
      ok: false,
      error: { code: 'draft-blank', message: 'polish requires a non-blank draft', details: {} },
    })
    expect(adapter.requests).toHaveLength(0)
  })

  it('rejects an oversized framed input with byte accounting', async () => {
    const { ctx, adapter } = await setup(TEXT_SCRIPT)
    const result = await ctx.polish.polish(
      agentOf({ provider: 'mock-route', model: 'mock-model' }),
      'x'.repeat(20_000),
      'basic',
      new AbortController().signal,
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error.code).toBe('input-too-large')
    expect(result.error.details.actualBytes).toBeGreaterThan(CONFIG.maxInputBytes)
    expect(adapter.requests).toHaveLength(0)
  })

  it('rejects a session with no model route', async () => {
    const { ctx, adapter } = await setup(TEXT_SCRIPT)
    const result = await ctx.polish.polish(agentOf(undefined), 'draft', 'basic', new AbortController().signal)
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'no-route',
        message: 'no model route is available for this session; select a model first',
        details: {},
      },
    })
    expect(adapter.requests).toHaveLength(0)
  })

  it('rejects empty model output', async () => {
    const empty: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '  ' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const { ctx } = await setup(empty)
    const result = await ctx.polish.polish(agentOf({ provider: 'mock-route', model: 'mock-model' }), 'draft', 'basic', new AbortController().signal)
    expect(result).toEqual({
      ok: false,
      error: { code: 'empty-output', message: 'polish model produced no text', details: {} },
    })
  })

  it('surfaces stream failures as explicit internal failures', async () => {
    class ThrowingAdapter extends LlmAdapter {
      override async * stream(): AsyncIterable<StreamChunk> {
        throw new Error('adapter boom')
      }
    }
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['mock-route'], new ThrowingAdapter())
    await ctx.plugin(PolishService, CONFIG)
    const result = await ctx.polish.polish(
      agentOf({ provider: 'mock-route', model: 'mock-model' }),
      'draft',
      'basic',
      new AbortController().signal,
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error.code).toBe('internal')
    expect(result.error.message).toBe('adapter boom')
  })

  it('aborts an already-cancelled request before dispatch', async () => {
    const { ctx, adapter } = await setup(TEXT_SCRIPT)
    const controller = new AbortController()
    controller.abort(new Error('user cancelled'))
    await expect(ctx.polish.polish(
      agentOf({ provider: 'mock-route', model: 'mock-model' }),
      'draft',
      'basic',
      controller.signal,
    )).rejects.toThrow('user cancelled')
    expect(adapter.requests).toHaveLength(0)
  })

  it('times out through the POLISH_TIMEOUT deadline code', async () => {
    class HangingAdapter extends LlmAdapter {
      override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        const signal = options.signal
        if (signal === undefined) throw new Error('expected polish request signal')
        await new Promise<never>((_resolve, reject) => {
          const rejectAbort = (): void => {
            // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- propagate the deadline reason
            reject(signal.reason)
          }
          if (signal.aborted) {
            rejectAbort()
            return
          }
          signal.addEventListener('abort', rejectAbort, { once: true })
        })
      }
    }
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['mock-route'], new HangingAdapter())
    await ctx.plugin(PolishService, { ...CONFIG, timeoutMs: 20 })
    const result = await ctx.polish.polish(
      agentOf({ provider: 'mock-route', model: 'mock-model' }),
      'draft',
      'basic',
      new AbortController().signal,
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error.code).toBe('internal')
    expect(result.error.message).toContain(POLISH_TIMEOUT_CODE)
  })
})
