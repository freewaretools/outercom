import { test } from "node:test"
import assert from "node:assert/strict"
import { ChatEngine } from "../src/engine.ts"
import { InMemoryStorage } from "../src/storage.ts"
import type { ChatMessage, ChatSession } from "../src/types.ts"
import { FakeTransport, FakeAI } from "./helpers.ts"

const TEN_MIN = 10 * 60_000
const visitor = { name: "Ada", email: "ada@example.com" }

/**
 * Seed an escalated session directly, so we can place the escalation at an
 * arbitrary point in the past without waiting or stubbing the clock.
 */
async function seedEscalated(
  storage: InMemoryStorage,
  opts: { escalatedMsAgo: number; agentReplied?: boolean }
) {
  const now = Date.now()
  const session: ChatSession = {
    id: "s1",
    visitor,
    threadId: "1",
    status: "live",
    createdAt: now - opts.escalatedMsAgo - 1000,
    updatedAt: now,
  }
  await storage.createSession(session)
  const msg = (role: ChatMessage["role"], text: string, at: number): ChatMessage => ({
    id: `${role}-${at}`,
    sessionId: "s1",
    role,
    text,
    createdAt: at,
  })
  await storage.appendMessage(msg("visitor", "help", now - opts.escalatedMsAgo - 500))
  await storage.appendMessage(
    msg("system", "I've passed this to our team", now - opts.escalatedMsAgo)
  )
  if (opts.agentReplied) {
    await storage.appendMessage(msg("agent", "on it", now - opts.escalatedMsAgo + 100))
  }
  return session
}

function build(aiResumeAfterMs?: number) {
  const storage = new InMemoryStorage()
  const transport = new FakeTransport()
  const ai = new FakeAI()
  const engine = new ChatEngine({
    storage,
    transport,
    ai,
    ...(aiResumeAfterMs !== undefined ? { aiResumeAfterMs } : {}),
  })
  return { storage, transport, ai, engine }
}

test("resumes the AI when nobody replied within the window", async () => {
  const { storage, engine, ai } = build()
  await seedEscalated(storage, { escalatedMsAgo: TEN_MIN + 1000 })

  const { session, newMessages } = await engine.handleVisitorMessage("s1", "hello?")

  assert.equal(session.status, "ai", "session should hand back to the AI")
  assert.equal(ai.calls, 1)
  assert.ok(
    newMessages.some((m) => m.role === "ai"),
    "the stranded visitor should finally get an answer"
  )
})

test("never talks over a human who has replied", async () => {
  const { storage, engine, ai } = build()
  // Way past the window, but an agent is in the conversation.
  await seedEscalated(storage, { escalatedMsAgo: TEN_MIN * 10, agentReplied: true })

  const { session, newMessages } = await engine.handleVisitorMessage("s1", "hello?")

  assert.equal(session.status, "live", "must stay with the human")
  assert.equal(ai.calls, 0)
  assert.equal(newMessages.length, 0)
})

test("stays live inside the window", async () => {
  const { storage, engine, ai } = build()
  await seedEscalated(storage, { escalatedMsAgo: 60_000 })

  const { session } = await engine.handleVisitorMessage("s1", "hello?")

  assert.equal(session.status, "live")
  assert.equal(ai.calls, 0)
})

test("aiResumeAfterMs: 0 disables resuming entirely", async () => {
  const { storage, engine, ai } = build(0)
  await seedEscalated(storage, { escalatedMsAgo: TEN_MIN * 100 })

  const { session } = await engine.handleVisitorMessage("s1", "hello?")

  assert.equal(session.status, "live")
  assert.equal(ai.calls, 0)
})

test("resuming tells the agents it happened", async () => {
  const { storage, transport, engine } = build()
  await seedEscalated(storage, { escalatedMsAgo: TEN_MIN + 1000 })

  await engine.handleVisitorMessage("s1", "hello?")

  assert.ok(
    transport.sentTo("1").some((t) => t.includes("AI has picked this back up")),
    "agents should see the handback in the topic"
  )
})

test("a human-only engine (no AI) never resumes", async () => {
  const storage = new InMemoryStorage()
  const transport = new FakeTransport()
  const engine = new ChatEngine({ storage, transport })
  await seedEscalated(storage, { escalatedMsAgo: TEN_MIN * 10 })

  const { session } = await engine.handleVisitorMessage("s1", "hello?")

  assert.equal(session.status, "live")
})
