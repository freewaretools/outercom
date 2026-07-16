import type { ParsedAgentReply } from "./types"

/**
 * The "human handoff" seam. A transport routes a conversation to wherever your
 * team already works and relays their replies back.
 *
 * v1 ships {@link TelegramTransport}. The interface is deliberately small so a
 * SlackTransport (thread per chat in a channel), DiscordTransport, or
 * email/SMTP transport can be added without touching the engine. Thread ids are
 * opaque strings so any backend's native id fits (Telegram `message_thread_id`,
 * Slack `thread_ts`, etc.).
 */
/** Outcome of a {@link ChatTransport.sendMessage}. */
export interface SendResult {
  /** True when the message was delivered. */
  ok: boolean
  /**
   * The target thread no longer exists upstream — e.g. someone deleted the
   * Telegram topic. Distinct from an ordinary failure: the engine responds by
   * creating a fresh thread and retrying, rather than dropping the message.
   * Transports that can't tell the difference should leave this unset.
   */
  threadGone?: boolean
}

export interface ChatTransport {
  /** Create a thread/topic for a new chat and return its opaque id. */
  createTopic(name: string): Promise<string>
  /**
   * Post a message into a thread. Best-effort: reports failure via the result
   * rather than throwing.
   */
  sendMessage(threadId: string, text: string): Promise<SendResult>
  /** Close/archive a thread when the conversation ends. */
  closeTopic(threadId: string): Promise<void>
  /**
   * Reopen a previously closed thread. Returns false only when the thread is
   * *gone* (deleted upstream), so the caller can mint a replacement. Return
   * true when it reopened, was already open, or the backend has no such concept
   * — anything else would spawn duplicate threads on transient errors.
   */
  reopenTopic(threadId: string): Promise<boolean>
  /** Parse an inbound webhook payload into an agent reply, or null if irrelevant. */
  parseUpdate(update: unknown): ParsedAgentReply | null
}
