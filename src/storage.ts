import type { ChatMessage, ChatSession, ChatRole } from "./types"

/**
 * Persistence seam. The host app supplies a concrete implementation
 * (e.g. Postgres/Prisma) so chatkit itself stays storage-agnostic.
 *
 * Sessions and the agent↔visitor relay are inherently async and survive
 * across requests/cold-starts, so a real adapter must be durable — the
 * in-memory adapter below is for local dev and the OSS demo only.
 */
export interface ChatStorage {
  createSession(session: ChatSession): Promise<void>
  getSession(id: string): Promise<ChatSession | null>
  /** Map an inbound transport thread back to its session. */
  getSessionByThread(threadId: string): Promise<ChatSession | null>
  /**
   * Most recent thread id for a visitor email (case-insensitive), or null.
   * Lets the engine reuse one topic per customer instead of spawning a new one
   * each time they start a chat.
   */
  getThreadByEmail(email: string): Promise<string | null>
  updateSession(id: string, patch: Partial<ChatSession>): Promise<void>

  /**
   * Non-closed sessions whose visitor hasn't been seen since `beforeTs`
   * (using lastSeenAt, falling back to createdAt). Used to find disconnected
   * visitors who may have unseen replies to email.
   */
  getSessionsIdleSince(beforeTs: number): Promise<ChatSession[]>

  appendMessage(message: ChatMessage): Promise<void>
  getMessages(
    sessionId: string,
    opts?: { after?: number; roles?: ChatRole[] }
  ): Promise<ChatMessage[]>
}

/**
 * Reference adapter — keeps everything in process memory. Fine for `next dev`
 * on a single instance and for trying the OSS demo; do NOT use in production
 * (state is lost on restart and not shared across instances).
 */
export class InMemoryStorage implements ChatStorage {
  private sessions = new Map<string, ChatSession>()
  private threadIndex = new Map<string, string>()
  private messages = new Map<string, ChatMessage[]>()

  async createSession(session: ChatSession): Promise<void> {
    this.sessions.set(session.id, { ...session })
    if (session.threadId != null) {
      this.threadIndex.set(session.threadId, session.id)
    }
    if (!this.messages.has(session.id)) this.messages.set(session.id, [])
  }

  async getSession(id: string): Promise<ChatSession | null> {
    const s = this.sessions.get(id)
    return s ? { ...s } : null
  }

  async getSessionByThread(threadId: string): Promise<ChatSession | null> {
    const id = this.threadIndex.get(threadId)
    return id ? this.getSession(id) : null
  }

  async getThreadByEmail(email: string): Promise<string | null> {
    const target = email.trim().toLowerCase()
    let latest: ChatSession | null = null
    for (const s of this.sessions.values()) {
      if (s.threadId && s.visitor.email.trim().toLowerCase() === target) {
        if (!latest || s.createdAt > latest.createdAt) latest = s
      }
    }
    return latest?.threadId ?? null
  }

  async updateSession(id: string, patch: Partial<ChatSession>): Promise<void> {
    const existing = this.sessions.get(id)
    if (!existing) return
    const next = { ...existing, ...patch, updatedAt: Date.now() }
    this.sessions.set(id, next)
    if (patch.threadId != null) {
      this.threadIndex.set(patch.threadId, id)
    }
  }

  async getSessionsIdleSince(beforeTs: number): Promise<ChatSession[]> {
    const out: ChatSession[] = []
    for (const s of this.sessions.values()) {
      if (s.status === "closed") continue
      if ((s.lastSeenAt ?? s.createdAt) < beforeTs) out.push({ ...s })
    }
    return out
  }

  async appendMessage(message: ChatMessage): Promise<void> {
    const list = this.messages.get(message.sessionId) ?? []
    list.push({ ...message })
    this.messages.set(message.sessionId, list)
  }

  async getMessages(
    sessionId: string,
    opts?: { after?: number; roles?: ChatRole[] }
  ): Promise<ChatMessage[]> {
    let list = this.messages.get(sessionId) ?? []
    if (opts?.after != null) list = list.filter((m) => m.createdAt > opts.after!)
    if (opts?.roles) list = list.filter((m) => opts.roles!.includes(m.role))
    return list.map((m) => ({ ...m }))
  }
}
