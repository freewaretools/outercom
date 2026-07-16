import { test } from "node:test"
import assert from "node:assert/strict"
import { ChatEngine } from "../src/engine.ts"
import { InMemoryStorage } from "../src/storage.ts"
import type { ChatMessage, ChatSession } from "../src/types.ts"
import type { ChatTransport, SendResult } from "../src/transport.ts"
import { FakeTransport, FakeAI, flush } from "./helpers.ts"

const visitor = { name: "Ada", email: "ada@example.com" }
const TEN_MIN = 10 * 60_000

/**
 * Regressions for the four defects an adversarial review of v0.5.0 confirmed.
 * Each reproduces the reviewer's probe.
 */

// --- 1. AI must not talk over a human in a SHARED thread ---------------------

test("a co-tenant session never resumes while another session owns the thread", async () => {
  const storage = new InMemoryStorage()
  const transport = new FakeTransport()
  const ai = new FakeAI()
  const engine = new ChatEngine({ storage, transport, ai })

  // Session A: escalated 11 min ago, still live, on thread "1".
  const now = Date.now()
  const a: ChatSession = {
    id: "A",
    visitor,
    threadId: "1",
    status: "live",
    createdAt: now - TEN_MIN - 60_000,
    updatedAt: now,
  }
  await storage.createSession(a)
  const sys: ChatMessage = {
    id: "sys",
    sessionId: "A",
    role: "system",
    text: "I've passed this to our team",
    createdAt: now - TEN_MIN - 1000,
  }
  await storage.appendMessage(sys)

  // The same visitor opens a second client → session B reuses thread "1" and
  // becomes the thread's owner. An agent reply would land on B, not A.
  const b = await engine.startSession(visitor)
  await flush()
  const bSession = await storage.getSession(b.sessionId)
  assert.equal(bSession?.threadId, "1", "B should reuse the shared thread")

  // A pings from the stale client. It must NOT resume — a human may be in
  // topic 1, and A structurally cannot see their reply.
  const { session } = await engine.handleVisitorMessage("A", "hello?")

  assert.equal(session.status, "live", "stale co-tenant must not resume")
  assert.equal(ai.calls, 0, "AI must not speak into a thread it doesn't own")
})

test("the thread owner still resumes normally", async () => {
  const storage = new InMemoryStorage()
  const transport = new FakeTransport()
  const ai = new FakeAI()
  const engine = new ChatEngine({ storage, transport, ai })

  const now = Date.now()
  await storage.createSession({
    id: "solo",
    visitor,
    threadId: "1",
    status: "live",
    createdAt: now - TEN_MIN - 60_000,
    updatedAt: now,
  })
  await storage.appendMessage({
    id: "sys",
    sessionId: "solo",
    role: "system",
    text: "I've passed this to our team",
    createdAt: now - TEN_MIN - 1000,
  })

  const { session } = await engine.handleVisitorMessage("solo", "hello?")

  assert.equal(session.status, "ai", "the owning session should still resume")
  assert.equal(ai.calls, 1)
})

// --- 2. abandonSession must not resurrect a dead topic -----------------------

test("abandoning a chat whose topic was deleted does not spawn a new topic", async () => {
  const storage = new InMemoryStorage()
  const transport = new FakeTransport()
  const engine = new ChatEngine({ storage, transport, ai: new FakeAI() })

  const { sessionId } = await engine.startSession(visitor)
  await flush()
  transport.killThread("1")

  await engine.abandonSession(sessionId)

  assert.equal(
    transport.created.length,
    1,
    "a chat that is ending must not resurrect its deleted topic"
  )
  assert.equal(
    transport.sentTo("2").length,
    0,
    "nothing should be posted to a resurrected topic"
  )
  const session = await storage.getSession(sessionId)
  assert.equal(session?.status, "closed", "the session should still close cleanly")
})

// --- 3. the startSession intro heals too -------------------------------------

/** Spec-compliant transport with no reopen concept (e.g. Slack thread_ts). */
class NoReopenTransport implements ChatTransport {
  readonly created: string[] = []
  readonly sent: Array<{ threadId: string; text: string }> = []
  private readonly dead = new Set<string>()
  private next = 1

  async createTopic(name: string): Promise<string> {
    this.created.push(name)
    return String(this.next++)
  }
  async sendMessage(threadId: string, text: string): Promise<SendResult> {
    if (this.dead.has(threadId)) return { ok: false, threadGone: true }
    this.sent.push({ threadId, text })
    return { ok: true }
  }
  async closeTopic(): Promise<void> {}
  // Permitted by the interface: "true when ... the backend has no such concept".
  async reopenTopic(): Promise<boolean> {
    return true
  }
  parseUpdate() {
    return null
  }
  kill(threadId: string): void {
    this.dead.add(threadId)
  }
}

test("the intro heals when reopenTopic can't detect a dead thread", async () => {
  const storage = new InMemoryStorage()
  const transport = new NoReopenTransport()
  const engine = new ChatEngine({ storage, transport, ai: new FakeAI() })

  await engine.startSession(visitor)
  await flush()
  transport.kill("1")

  // Returning visitor: getThreadByEmail hands back dead thread "1", and this
  // transport can't report it via reopenTopic — so the intro send must heal.
  const second = await engine.startSession(visitor)
  await flush()

  assert.equal(transport.created.length, 2, "the intro should mint a replacement")
  const session = await storage.getSession(second.sessionId)
  assert.equal(session?.threadId, "2", "the dead thread must not be persisted")
  assert.ok(
    transport.sent.some((s) => s.threadId === "2" && s.text.includes("Ada")),
    "the intro must actually reach the team"
  )
})

// --- 4. a synchronous storage throw must not poison the revive map -----------

test("a synchronous storage throw does not permanently disable revival", async () => {
  const storage = new InMemoryStorage()
  const transport = new FakeTransport()
  const engine = new ChatEngine({ storage, transport, ai: new FakeAI() })

  const { sessionId } = await engine.startSession(visitor)
  await flush()
  transport.killThread("1")

  // A non-async adapter that throws before returning a promise (an ordinary
  // "guard clause" pattern) — legal against the ChatStorage signature.
  // Call 1 of a message is requireSession; call 2 is reviveThread's re-read,
  // which is the one that must not poison the in-flight map.
  const realGetSession = storage.getSession.bind(storage)
  let calls = 0
  ;(storage as { getSession: unknown }).getSession = (id: string) => {
    calls++
    if (calls === 2) throw new Error("pool not ready")
    return realGetSession(id)
  }

  await engine.handleVisitorMessage(sessionId, "first").catch(() => {})

  // Storage is healthy again — revival must still work.
  await engine.handleVisitorMessage(sessionId, "second")

  const session = await storage.getSession(sessionId)
  assert.equal(session?.threadId, "2", "revival must recover after a sync throw")
  assert.equal(transport.created.length, 2)
})
