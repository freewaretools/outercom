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
export interface ChatTransport {
  /** Create a thread/topic for a new chat and return its opaque id. */
  createTopic(name: string): Promise<string>
  /** Post a message into a thread. Should be best-effort (not throw). */
  sendMessage(threadId: string, text: string): Promise<void>
  /** Close/archive a thread when the conversation ends. */
  closeTopic(threadId: string): Promise<void>
  /** Reopen a previously closed thread (best-effort; no-op where not applicable). */
  reopenTopic(threadId: string): Promise<void>
  /** Parse an inbound webhook payload into an agent reply, or null if irrelevant. */
  parseUpdate(update: unknown): ParsedAgentReply | null
}
