import type { ChatTransport } from "./transport"
import type { ParsedAgentReply } from "./types"

export interface TelegramConfig {
  /** Bot token from @BotFather (use a DEDICATED bot for chat, not your ops bot). */
  botToken: string
  /**
   * Chat id of the support group. Must be a *forum* supergroup (Topics enabled)
   * and the bot must be an admin with "Manage Topics" permission, otherwise
   * `createForumTopic` fails.
   */
  chatId: string | number
}

/**
 * Telegram transport. v1 of chatkit's "human handoff" surface — designed
 * behind a thin interface so other transports (Slack, Discord, email) can be
 * added later without touching the engine.
 *
 * Each chat session gets its own forum topic; the agent replies inside that
 * topic and the webhook maps `message_thread_id` back to the session.
 */
export class TelegramTransport implements ChatTransport {
  constructor(private readonly cfg: TelegramConfig) {}

  private async call<T = unknown>(
    method: string,
    body: Record<string, unknown>
  ): Promise<T> {
    const res = await fetch(
      `https://api.telegram.org/bot${this.cfg.botToken}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.cfg.chatId, ...body }),
      }
    )
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      result?: T
      description?: string
    }
    if (!data.ok) {
      throw new Error(
        `Telegram ${method} failed: ${data.description ?? res.status}`
      )
    }
    return data.result as T
  }

  /** Create a forum topic and return its `message_thread_id` (as a string). */
  async createTopic(name: string): Promise<string> {
    // Telegram truncates topic names at 128 chars.
    const result = await this.call<{ message_thread_id: number }>(
      "createForumTopic",
      { name: name.slice(0, 128) }
    )
    return String(result.message_thread_id)
  }

  /** Post a message into a topic. Best-effort: never throws to the caller. */
  async sendMessage(threadId: string, text: string): Promise<void> {
    try {
      await this.call("sendMessage", {
        message_thread_id: Number(threadId),
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      })
    } catch (err) {
      console.error("[chatkit] telegram sendMessage failed:", err)
    }
  }

  /** Close a topic when a conversation ends (keeps the group tidy). */
  async closeTopic(threadId: string): Promise<void> {
    try {
      await this.call("closeForumTopic", { message_thread_id: Number(threadId) })
    } catch (err) {
      console.error("[chatkit] telegram closeForumTopic failed:", err)
    }
  }

  /** Reopen a closed topic (so a returning visitor reuses the same thread). */
  async reopenTopic(threadId: string): Promise<void> {
    try {
      await this.call("reopenForumTopic", { message_thread_id: Number(threadId) })
    } catch {
      // Already open, or topic gone — non-fatal.
    }
  }

  /**
   * Parse an inbound webhook update into an agent reply, or `null` if it isn't
   * a relevant human message. Bots don't receive their own messages, so AI/bot
   * echoes never come back through here. Service messages (topic created, etc.)
   * and non-topic chatter are ignored.
   */
  parseUpdate(update: unknown): ParsedAgentReply | null {
    const msg = (update as { message?: TelegramMessage })?.message
    if (!msg) return null
    if (msg.message_thread_id == null) return null // not inside a topic
    if (msg.from?.is_bot) return null
    if (msg.forum_topic_created || msg.forum_topic_closed) return null

    const text = (msg.text ?? msg.caption ?? "").trim()
    if (!text) return null

    const fromName =
      [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") ||
      msg.from?.username

    const threadId = String(msg.message_thread_id)
    const lower = text.toLowerCase()
    if (lower === "/close" || lower === "/end") {
      return { threadId, text, fromName, command: "close" }
    }

    return { threadId, text, fromName }
  }
}

interface TelegramMessage {
  message_thread_id?: number
  text?: string
  caption?: string
  forum_topic_created?: unknown
  forum_topic_closed?: unknown
  from?: {
    is_bot?: boolean
    first_name?: string
    last_name?: string
    username?: string
  }
}
