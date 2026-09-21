import type { ChatTransport, SendResult } from "./transport"
import type { ParsedAgentReply } from "./types"

/** A non-ok response from the Bot API, carrying Telegram's own `description`. */
export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly description: string,
    readonly status: number
  ) {
    super(`Telegram ${method} failed: ${description || status}`)
    this.name = "TelegramApiError"
  }
}

/**
 * Does this error mean the topic itself is gone (someone deleted it)?
 *
 * Deliberately narrow. `TOPIC_NOT_MODIFIED` (already open), `chat not found`
 * (wrong group id) and auth errors all leave the topic intact — treating those
 * as "gone" would spawn a duplicate topic on every transient hiccup.
 */
export function isThreadGone(err: unknown): boolean {
  if (!(err instanceof TelegramApiError)) return false
  return /message thread not found|TOPIC_DELETED/i.test(err.description)
}

/** Renaming a topic to the name it already has — harmless, not a failure. */
function isNotModified(err: unknown): boolean {
  return err instanceof TelegramApiError && /TOPIC_NOT_MODIFIED/i.test(err.description)
}

export interface TelegramConfig {
  /** Bot token from @BotFather (use a DEDICATED bot for chat, not your ops bot). */
  botToken: string
  /**
   * Chat id of the support group. Must be a *forum* supergroup (Topics enabled)
   * and the bot must be an admin with "Manage Topics" permission, otherwise
   * `createForumTopic` fails.
   */
  chatId: string | number
  /**
   * How a finished chat is marked in the group.
   * - `"rename"` (default) — prefix the topic name with {@link closedPrefix}. The
   *   topic stays open, so agents who aren't group admins can still read and
   *   reply in it. Telegram makes a *closed* topic read-only for non-admins, which
   *   is the failure this mode exists to avoid.
   * - `"lock"` — the legacy behaviour: `closeForumTopic` / `reopenForumTopic`.
   */
  closeStyle?: "rename" | "lock"
  /** Prefix added to a finished chat's topic name in `"rename"` mode. Default `"✅ "`. */
  closedPrefix?: string
  /** `fetch` override (tests, proxies). Defaults to the global. */
  fetch?: typeof fetch
}

const DEFAULT_CLOSED_PREFIX = "✅ "

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
    const res = await (this.cfg.fetch ?? fetch)(
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
      throw new TelegramApiError(method, data.description ?? "", res.status)
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
  async sendMessage(threadId: string, text: string): Promise<SendResult> {
    try {
      await this.call("sendMessage", {
        message_thread_id: Number(threadId),
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      })
      return { ok: true }
    } catch (err) {
      // A deleted topic isn't an error worth logging here — the engine recreates
      // the thread and says so. Everything else is a genuine failure.
      if (isThreadGone(err)) return { ok: false, threadGone: true }
      console.error("[chatkit] telegram sendMessage failed:", err)
      return { ok: false }
    }
  }

  /**
   * Mark a topic finished. In the default `"rename"` mode the topic is renamed
   * with a prefix and stays open (see {@link TelegramConfig.closeStyle}); Telegram
   * can't read a topic's name back, so `name` must be supplied — without it there
   * is nothing to rename and the call is a no-op.
   */
  async closeTopic(threadId: string, name?: string): Promise<void> {
    if (this.cfg.closeStyle === "lock") {
      try {
        await this.call("closeForumTopic", { message_thread_id: Number(threadId) })
      } catch (err) {
        console.error("[chatkit] telegram closeForumTopic failed:", err)
      }
      return
    }
    if (name === undefined) return
    const prefix = this.cfg.closedPrefix ?? DEFAULT_CLOSED_PREFIX
    try {
      await this.editName(threadId, prefix + name)
    } catch (err) {
      if (!isNotModified(err)) {
        console.error("[chatkit] telegram editForumTopic (close) failed:", err)
      }
    }
  }

  /**
   * Reopen a finished topic (so a returning visitor reuses the same thread).
   * Returns false only if the topic has been deleted, so the caller knows to
   * create a new one instead of writing into a thread that no longer exists.
   *
   * In `"rename"` mode this also calls `reopenForumTopic` first: topics locked by
   * an older version (or by hand) are unlocked on the visitor's next return, so
   * switching modes needs no migration.
   */
  async reopenTopic(threadId: string, name?: string): Promise<boolean> {
    try {
      await this.call("reopenForumTopic", { message_thread_id: Number(threadId) })
    } catch (err) {
      // Already open (TOPIC_NOT_MODIFIED) and transient errors both mean the
      // topic is still there; only a deleted one warrants a replacement.
      if (isThreadGone(err)) return false
    }
    if (this.cfg.closeStyle === "lock" || name === undefined) return true
    try {
      await this.editName(threadId, name)
    } catch (err) {
      if (isThreadGone(err)) return false
      if (!isNotModified(err)) {
        console.error("[chatkit] telegram editForumTopic (reopen) failed:", err)
      }
    }
    return true
  }

  private async editName(threadId: string, name: string): Promise<void> {
    // Telegram truncates topic names at 128 chars.
    await this.call("editForumTopic", {
      message_thread_id: Number(threadId),
      name: name.slice(0, 128),
    })
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
