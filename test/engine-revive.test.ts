import { test } from "node:test"
import assert from "node:assert/strict"
import { ChatEngine } from "../src/engine.ts"
import { InMemoryStorage } from "../src/storage.ts"
import { FakeTransport, FakeAI, flush } from "./helpers.ts"

const visitor = { name: "Ada", email: "ada@example.com" }

function build(transport = new FakeTransport()) {
  const storage = new InMemoryStorage()
  const engine = new ChatEngine({ storage, transport, ai: new FakeAI() })
  return { storage, transport, engine }
}

test("a deleted topic is recreated and the message retried", async () => {
  const { storage, transport, engine } = build()
  const { sessionId } = await engine.startSession(visitor)
  await flush()
  assert.equal(transport.created.length, 1)

  // An agent deletes the topic — this is what happened in production.
  transport.killThread("1")

  await engine.handleVisitorMessage(sessionId, "are you there?")

  // A replacement topic was minted, exactly once...
  assert.equal(transport.created.length, 2)
  // ...persisted, so the session stops pointing at the dead thread...
  const session = await storage.getSession(sessionId)
  assert.equal(session?.threadId, "2")
  // ...and the visitor's message actually landed in the new topic.
  const relayed = transport.sentTo("2")
  assert.ok(
    relayed.some((t) => t.includes("are you there?")),
    `expected the message in the new topic, got: ${JSON.stringify(relayed)}`
  )
  // The agent gets context rather than a bare topic.
  assert.ok(relayed.some((t) => t.includes("Topic recreated")))
})

test("concurrent messages revive the thread only once", async () => {
  const { storage, transport, engine } = build()
  const { sessionId } = await engine.startSession(visitor)
  await flush()
  transport.killThread("1")

  // A visitor firing off three messages at once must not mint three topics.
  await Promise.all([
    engine.handleVisitorMessage(sessionId, "one"),
    engine.handleVisitorMessage(sessionId, "two"),
    engine.handleVisitorMessage(sessionId, "three"),
  ])

  assert.equal(transport.created.length, 2, "should create exactly one replacement")
  const session = await storage.getSession(sessionId)
  assert.equal(session?.threadId, "2")
})

test("a healthy thread is never recreated", async () => {
  const { transport, engine } = build()
  const { sessionId } = await engine.startSession(visitor)
  await flush()

  await engine.handleVisitorMessage(sessionId, "hi")
  await engine.handleVisitorMessage(sessionId, "still there")

  assert.equal(transport.created.length, 1)
})

test("a returning visitor whose topic was deleted gets a fresh one", async () => {
  const { transport, engine } = build()
  const first = await engine.startSession(visitor)
  await flush()
  await engine.closeSession(first.sessionId)

  // The topic is deleted between chats; getThreadByEmail still remembers it.
  transport.killThread("1")
  const deadThreadSends = transport.sentTo("1").length

  await engine.startSession(visitor)
  await flush()

  assert.equal(transport.created.length, 2, "should not reuse the dead thread")
  assert.ok(transport.sentTo("2").length > 0, "new chat should land in the new topic")
  assert.equal(
    transport.sentTo("1").length,
    deadThreadSends,
    "nothing more should be written to the deleted topic"
  )
})

test("revive failure degrades quietly instead of breaking the chat", async () => {
  const { transport, engine } = build()
  const { sessionId } = await engine.startSession(visitor)
  await flush()
  transport.killThread("1")
  transport.createFails = true

  // The visitor must still get their AI reply even with the transport dead.
  const { newMessages } = await engine.handleVisitorMessage(sessionId, "hello?")
  assert.ok(newMessages.some((m) => m.role === "ai"))
})
