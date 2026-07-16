import type { ChatStorage } from "./storage"
import type { ChatTransport } from "./transport"
import type {
  AIProvider,
  ChatMessage,
  ChatRole,
  ChatSession,
  ChatVisitor,
} from "./types"

export interface ChatEngineOptions {
  storage: ChatStorage
  transport: ChatTransport
  /** Optional first-line AI. Omit (or pass `aiEnabled: false`) for human-only chat. */
  ai?: AIProvider
  aiEnabled?: boolean
  /** Builds the forum-topic title for a new chat. Default: "Name · email". */
  topicName?: (visitor: ChatVisitor) => string
  /** Message shown to the visitor when a chat is escalated to a human. */
  escalationMessage?: string
  /**
   * How long an escalated chat may sit with no agent reply before the AI picks
   * it back up, in ms. Guards against a visitor being stranded in silence when
   * nobody is watching the transport. Default: 10 minutes. Set `0` to disable
   * (an escalation then hands off permanently, as before).
   *
   * Only ever fires when *no* agent has replied in the session, so it can't cut
   * in on a human who is simply typing slowly.
   */
  aiResumeAfterMs?: number
  /**
   * Optional hook to email/send a transcript. Called when a chat is closed and
   * when the visitor requests a copy. Host-provided (e.g. render + Resend) so
   * chatkit stays mailer-agnostic.
   */
  sendTranscript?: (session: ChatSession, messages: ChatMessage[]) => Promise<void>
  /**
   * Optional hook to email a visitor replies they haven't seen (because they
   * disconnected). Called by {@link flushUnseen}. Host-provided.
   */
  sendReplyNotification?: (
    session: ChatSession,
    unseen: ChatMessage[]
  ) => Promise<void>
}

const DEFAULT_ESCALATION =
  "I've passed this to our team — someone will jump in here shortly. Feel free to add any extra detail in the meantime."

/** Default window before an unanswered escalation falls back to the AI. */
const DEFAULT_AI_RESUME_MS = 10 * 60_000

/** Messages the client should render (everything except the visitor's own echoes). */
const CLIENT_ROLES: ChatRole[] = ["ai", "agent", "system"]

/**
 * Orchestrates a conversation across the storage, Telegram transport, and the
 * optional AI first-line. Transport-agnostic at heart — `transport` is the only
 * Telegram-specific dependency and sits behind a small surface.
 */
export class ChatEngine {
  private readonly storage: ChatStorage
  private readonly transport: ChatTransport
  private readonly ai?: AIProvider
  private readonly aiEnabled: boolean
  private readonly topicName: (v: ChatVisitor) => string
  private readonly escalationMessage: string
  private readonly aiResumeAfterMs: number
  /** In-flight thread revivals, keyed by session id — see {@link reviveThread}. */
  private readonly reviving = new Map<string, Promise<string | null>>()
  private readonly sendTranscript?: (
    session: ChatSession,
    messages: ChatMessage[]
  ) => Promise<void>
  private readonly sendReplyNotification?: (
    session: ChatSession,
    unseen: ChatMessage[]
  ) => Promise<void>

  constructor(opts: ChatEngineOptions) {
    this.storage = opts.storage
    this.transport = opts.transport
    this.ai = opts.ai
    this.aiEnabled = (opts.aiEnabled ?? true) && !!opts.ai
    this.topicName =
      opts.topicName ?? ((v) => `${v.name} · ${v.email}`)
    this.escalationMessage = opts.escalationMessage ?? DEFAULT_ESCALATION
    this.aiResumeAfterMs = opts.aiResumeAfterMs ?? DEFAULT_AI_RESUME_MS
    this.sendTranscript = opts.sendTranscript
    this.sendReplyNotification = opts.sendReplyNotification
  }

  /** Email the visitor a transcript on demand. Returns false if no mailer is wired. */
  async emailTranscript(sessionId: string): Promise<boolean> {
    if (!this.sendTranscript) return false
    const session = await this.storage.getSession(sessionId)
    if (!session) return false
    try {
      const messages = await this.storage.getMessages(sessionId)
      await this.sendTranscript(session, messages)
      return true
    } catch (err) {
      console.error("[chatkit] sendTranscript failed:", err)
      return false
    }
  }

  /**
   * Start a new chat: create the session, open a Telegram topic, and post the
   * captured visitor details. The pre-chat form has already collected name +
   * email (+ optional question) so a topic-per-chat is created up front.
   */
  async startSession(visitor: ChatVisitor): Promise<{ sessionId: string }> {
    const id = crypto.randomUUID()
    const now = Date.now()

    // Reuse one topic per customer email; reopen it if a prior chat closed it.
    let threadId = await this.storage.getThreadByEmail(visitor.email)
    let reused = threadId !== null
    // Only an explicit `false` means the topic is gone. A transport that predates
    // the boolean return (or can't tell) yields undefined and is treated as
    // alive — assuming otherwise would recreate a topic on every return visit.
    if (threadId !== null && (await this.transport.reopenTopic(threadId)) === false) {
      // The remembered topic has been deleted — fall through and mint a new one
      // rather than stranding this chat on a dead thread.
      threadId = null
      reused = false
    }
    if (threadId === null) {
      try {
        threadId = await this.transport.createTopic(this.topicName(visitor))
      } catch (err) {
        // If topic creation fails (misconfigured group/perms), the chat still
        // works AI-only; agent relay just won't be available until fixed.
        console.error("[chatkit] could not create transport thread:", err)
        threadId = null
      }
    }

    const session: ChatSession = {
      id,
      visitor,
      threadId,
      status: this.aiEnabled ? "ai" : "live",
      createdAt: now,
      updatedAt: now,
    }
    await this.storage.createSession(session)

    // Post the Telegram intro + handle the opening question in the BACKGROUND so
    // "Start chat" returns immediately. Awaiting these blocked the widget on two
    // Telegram round-trips plus the full AI generation. The widget shows the
    // opening message optimistically and the AI reply arrives via poll().
    void (async () => {
      try {
        if (threadId != null) {
          const header = reused
            ? "🔁 <b>Returning visitor — new chat</b>"
            : "🆕 <b>New chat</b>"
          const intro =
            `${header}\n` +
            `From: ${esc(visitor.name)} (${esc(visitor.email)})\n` +
            (visitor.topic ? `Topic: ${esc(visitor.topic)}\n` : "") +
            (this.aiEnabled
              ? `\nThe AI assistant is handling this. Reply in this topic to take over.`
              : `\nReply in this topic to respond.`)
          // Via mirror(), not the transport directly, so a thread deleted
          // between reopenTopic and here still heals — otherwise the intro is
          // the one send that can silently vanish onto a dead thread.
          await this.mirror(session, intro)
        }
        // The pre-chat question becomes the visitor's opening message.
        if (visitor.topic) {
          await this.handleVisitorMessage(id, visitor.topic)
        }
      } catch (err) {
        console.error("[chatkit] post-start tasks failed:", err)
      }
    })()

    return { sessionId: id }
  }

  /**
   * Handle a visitor message: persist + mirror to Telegram, then (if the AI is
   * handling) generate a reply. Returns any new client-facing messages produced
   * synchronously (the AI reply / escalation note) so the widget can render
   * them immediately; async agent replies arrive via {@link poll}.
   */
  async handleVisitorMessage(
    sessionId: string,
    text: string
  ): Promise<{ session: ChatSession; newMessages: ChatMessage[] }> {
    const session = await this.requireSession(sessionId)
    const clean = text.trim()
    if (!clean) return { session, newMessages: [] }

    await this.append(session, "visitor", clean)
    await this.mirror(session, `💬 <b>${esc(session.visitor.name)}:</b> ${esc(clean)}`)

    const produced: ChatMessage[] = []

    await this.maybeResumeAi(session)

    if (session.status === "ai" && this.aiEnabled && this.ai) {
      try {
        const history = await this.storage.getMessages(sessionId)
        const ai = await this.ai.reply(history, session.visitor)

        if (ai.escalate) {
          await this.mirror(
            session,
            `🙋 <b>AI requested a human</b>${ai.reason ? ` — ${esc(ai.reason)}` : ""}`
          )
          const note = await this.append(session, "system", this.escalationMessage)
          produced.push(note)
          await this.storage.updateSession(sessionId, { status: "live" })
        } else {
          const reply = await this.append(session, "ai", ai.text)
          produced.push(reply)
          await this.mirror(session, `🤖 <b>AI:</b> ${esc(ai.text)}`)
        }
      } catch (err) {
        console.error("[chatkit] AI reply failed, escalating:", err)
        const note = await this.append(session, "system", this.escalationMessage)
        produced.push(note)
        await this.storage.updateSession(sessionId, { status: "live" })
        await this.mirror(session, `⚠️ <b>AI error — needs a human.</b>`)
      }
    }

    return { session: await this.requireSession(sessionId), newMessages: produced }
  }

  /**
   * Handle an inbound Telegram webhook update — a human agent replying in a
   * topic. Flips the session to `live` so the AI stays quiet, or closes it on
   * `/close`. Returns true if the update mapped to a known session.
   */
  async handleWebhookUpdate(update: unknown): Promise<boolean> {
    const parsed = this.transport.parseUpdate(update)
    if (!parsed) return false

    const session = await this.storage.getSessionByThread(parsed.threadId)
    if (!session) return false

    if (parsed.command === "close") {
      await this.closeSession(session.id)
      return true
    }

    await this.append(session, "agent", parsed.text, parsed.fromName)
    if (session.status !== "live") {
      await this.storage.updateSession(session.id, { status: "live" })
    }
    return true
  }

  /**
   * Poll for messages the visitor hasn't seen yet, plus the live status. Also
   * records the visitor as "seen" now (a present visitor is polling/heartbeating)
   * — the disconnect detector keys off this.
   */
  async poll(
    sessionId: string,
    after = 0
  ): Promise<{ status: ChatSession["status"]; messages: ChatMessage[] }> {
    const session = await this.requireSession(sessionId)
    const messages = await this.storage.getMessages(sessionId, {
      after,
      roles: CLIENT_ROLES,
    })
    if (session.status !== "closed") {
      await this.storage.updateSession(sessionId, { lastSeenAt: Date.now() })
    }
    return { status: session.status, messages }
  }

  /**
   * Email visitors who disconnected (no poll for >= thresholdMs) the agent/AI
   * replies they never saw. Idempotent via `notifiedAt`. Call from a cron.
   * Returns how many sessions were emailed.
   */
  async flushUnseen(thresholdMs: number): Promise<number> {
    if (!this.sendReplyNotification || thresholdMs <= 0) return 0
    const now = Date.now()
    const idle = await this.storage.getSessionsIdleSince(now - thresholdMs)
    let sent = 0
    for (const session of idle) {
      const since = Math.max(session.lastSeenAt ?? 0, session.notifiedAt ?? 0)
      const unseen = await this.storage.getMessages(session.id, {
        after: since,
        roles: ["ai", "agent"],
      })
      if (unseen.length === 0) continue
      try {
        await this.sendReplyNotification(session, unseen)
        await this.storage.updateSession(session.id, { notifiedAt: now })
        sent++
      } catch (err) {
        console.error("[chatkit] reply notification failed:", err)
      }
    }
    return sent
  }

  /**
   * The visitor ended/reset the chat from their side. Post a notice into the
   * topic so agents know replies won't reach them, then close it. No transcript
   * email (the visitor chose to start over, not to wrap up).
   */
  async abandonSession(sessionId: string): Promise<void> {
    const session = await this.storage.getSession(sessionId)
    if (!session || session.status === "closed") return
    await this.mirror(
      session,
      "🚪 <b>The visitor left / reset the chat.</b> Replies here won't reach them.",
      // The chat is over; if the topic is already gone there is nothing to save.
      { revive: false }
    )
    await this.storage.updateSession(sessionId, { status: "closed" })
    if (session.threadId != null) {
      await this.transport.closeTopic(session.threadId)
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = await this.storage.getSession(sessionId)
    if (!session) return
    const alreadyClosed = session.status === "closed"
    if (!alreadyClosed) {
      await this.append(session, "system", "This chat has been closed. Thanks for getting in touch!")
    }
    await this.storage.updateSession(sessionId, { status: "closed" })

    // Email the transcript once, on the transition to closed.
    if (!alreadyClosed && this.sendTranscript) {
      try {
        const messages = await this.storage.getMessages(sessionId)
        await this.sendTranscript(session, messages)
      } catch (err) {
        console.error("[chatkit] transcript on close failed:", err)
      }
    }

    if (session.threadId != null) {
      await this.transport.closeTopic(session.threadId)
    }
  }

  // --- internals -----------------------------------------------------------

  private async requireSession(id: string): Promise<ChatSession> {
    const s = await this.storage.getSession(id)
    if (!s) throw new ChatSessionNotFound(id)
    return s
  }

  /**
   * Hand an escalated chat back to the AI when no human ever picked it up.
   * Escalation is otherwise a one-way door: if the transport is misconfigured or
   * nobody is watching, the visitor sits in silence indefinitely.
   *
   * Mutates `session` in place so the caller's AI branch sees the new status.
   */
  private async maybeResumeAi(session: ChatSession): Promise<void> {
    if (session.status !== "live") return
    if (!this.aiEnabled || !this.ai || this.aiResumeAfterMs <= 0) return

    // One thread can serve several sessions (topics are reused per email), but
    // an inbound agent reply is recorded against only the session that
    // currently owns the thread. A non-owner therefore can't see that a human
    // is already in the topic — so it must never resume, or the AI would talk
    // over that human. Only the owner may speak for the thread.
    if (session.threadId != null) {
      const owner = await this.storage.getSessionByThread(session.threadId)
      if (owner != null && owner.id !== session.id) return
    }

    const history = await this.storage.getMessages(session.id)
    // If an agent has ever spoken, this chat belongs to them — never talk over
    // a human, however long they take to reply.
    if (history.some((m) => m.role === "agent")) return

    // The escalation notice is the only `system` message a live session can
    // have (close writes one too, but that sets status to `closed`), so its
    // timestamp is when the handoff started.
    const systems = history.filter((m) => m.role === "system")
    if (systems.length === 0) return
    const escalatedAt = systems[systems.length - 1].createdAt
    if (Date.now() - escalatedAt < this.aiResumeAfterMs) return

    await this.storage.updateSession(session.id, { status: "ai" })
    session.status = "ai"
    await this.mirror(
      session,
      "🤖 <b>No agent replied — the AI has picked this back up.</b>"
    )
  }

  private async append(
    session: ChatSession,
    role: ChatRole,
    text: string,
    authorName?: string
  ): Promise<ChatMessage> {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      role,
      text,
      createdAt: Date.now(),
      ...(authorName ? { authorName } : {}),
    }
    await this.storage.appendMessage(message)
    return message
  }

  /**
   * Relay text into the session's transport thread, healing the thread if it has
   * been deleted upstream. Best-effort throughout: a transport that is down must
   * never break the visitor's conversation.
   *
   * Pass `revive: false` for terminal notices (the chat is ending) — resurrecting
   * a deleted topic just to announce a chat nobody saw is noise, not recovery.
   */
  private async mirror(
    session: ChatSession,
    html: string,
    opts?: { revive?: boolean }
  ): Promise<void> {
    if (session.threadId == null) return
    // `res?` guards transports that predate SendResult and still return void.
    const res = await this.transport.sendMessage(session.threadId, html)
    if (!res?.threadGone) return
    if (opts?.revive === false) return

    // The topic was deleted out from under us. Without this the session is
    // pinned to a dead thread forever and every relay silently vanishes.
    const revived = await this.reviveThread(session)
    if (revived != null) await this.transport.sendMessage(revived, html)
  }

  /**
   * Replace a deleted transport thread with a fresh one and persist it, so the
   * session (and, via `getThreadByEmail`, the visitor's next session) stops
   * pointing at the dead id.
   *
   * Concurrent messages share one in-flight revival — otherwise a visitor firing
   * off three messages at once would mint three topics.
   */
  private reviveThread(session: ChatSession): Promise<string | null> {
    const existing = this.reviving.get(session.id)
    if (existing) return existing

    // Deferred via a microtask so the map entry below is installed BEFORE the
    // body runs. Invoking an async IIFE directly runs it synchronously up to
    // its first await — a storage adapter that throws synchronously would then
    // hit `finally` before `set`, leaving a resolved-null promise cached
    // forever and permanently disabling revival for this session.
    const task = Promise.resolve().then(async (): Promise<string | null> => {
      try {
        // A concurrent request may have already healed this session and cleared
        // the in-flight entry; adopt its thread instead of minting another.
        const fresh = await this.storage.getSession(session.id)
        if (fresh?.threadId != null && fresh.threadId !== session.threadId) {
          session.threadId = fresh.threadId
          return fresh.threadId
        }

        const threadId = await this.transport.createTopic(
          this.topicName(session.visitor)
        )
        await this.storage.updateSession(session.id, { threadId })
        session.threadId = threadId
        console.warn(
          "[chatkit] transport thread was gone — recreated as:",
          threadId
        )
        await this.transport.sendMessage(
          threadId,
          "🔁 <b>Topic recreated</b> — the previous one was deleted, so this chat continues here.\n" +
            `From: ${esc(session.visitor.name)} (${esc(session.visitor.email)})`
        )
        return threadId
      } catch (err) {
        console.error("[chatkit] could not recreate transport thread:", err)
        return null
      } finally {
        this.reviving.delete(session.id)
      }
    })

    this.reviving.set(session.id, task)
    return task
  }
}

export class ChatSessionNotFound extends Error {
  constructor(public readonly sessionId: string) {
    super(`chat session not found: ${sessionId}`)
    this.name = "ChatSessionNotFound"
  }
}

/** Escape text for Telegram HTML parse mode. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
