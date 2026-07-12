import type Anthropic from "@anthropic-ai/sdk"
import type { AIProvider, ChatMessage, ChatVisitor } from "./types"
import { buildSupportSystemPrompt, parseAIReply, toChatTurns } from "./prompt"

export interface AnthropicProviderConfig {
  apiKey: string
  /**
   * Model id. Defaults to Claude Haiku 4.5 — cheapest tier ($1/$5 per 1M
   * tokens), ample for grounded first-line support. Bump to
   * `claude-sonnet-4-6` if answers need more nuance.
   */
  model?: string
  /** Product/FAQ content the AI must ground its answers in. */
  knowledgeBase: string
  /** Company/brand name used in the persona. */
  brand?: string
  /** Extra persona/policy text appended to the system prompt. */
  systemPromptExtra?: string
  maxTokens?: number
}

const DEFAULT_MODEL = "claude-haiku-4-5"

/**
 * Claude-backed first-line responder. Asks for a small JSON envelope and parses
 * it defensively (falls back to plain text). No `thinking` / `effort` — both
 * error on Haiku 4.5 and a support first-line doesn't need them.
 */
export class AnthropicProvider implements AIProvider {
  private clientPromise: Promise<Anthropic> | null = null
  private readonly model: string
  private readonly maxTokens: number

  constructor(private readonly cfg: AnthropicProviderConfig) {
    this.model = cfg.model ?? DEFAULT_MODEL
    this.maxTokens = cfg.maxTokens ?? 1024
  }

  // Lazy-load the SDK so it's only required when Claude is actually used —
  // local-LLM / human-only consumers don't need @anthropic-ai/sdk installed.
  private client(): Promise<Anthropic> {
    if (!this.clientPromise) {
      this.clientPromise = import("@anthropic-ai/sdk").then(
        (m) => new m.default({ apiKey: this.cfg.apiKey })
      )
    }
    return this.clientPromise
  }

  async reply(history: ChatMessage[], visitor: ChatVisitor) {
    const turns = toChatTurns(history)
    if (turns.length === 0 || turns[0].role !== "user") {
      return { text: "Thanks for reaching out — how can I help?", escalate: false }
    }

    const client = await this.client()
    const res = await client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: buildSupportSystemPrompt(this.cfg, visitor),
      messages: turns,
    })

    const raw = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()

    return parseAIReply(raw)
  }
}
