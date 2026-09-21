import { test } from "node:test"
import assert from "node:assert/strict"
import { ChatEngine } from "../src/engine.ts"
import { InMemoryStorage } from "../src/storage.ts"
import { FakeTransport, flush } from "./helpers.ts"

const ada = { name: "Ada", email: "ada@example.com" }
const TITLE = "Ada · ada@example.com"

function build(storage = new InMemoryStorage()) {
  const transport = new FakeTransport()
  const engine = new ChatEngine({ storage, transport })
  return { storage, transport, engine }
}

// --- the title is the thread creator's, never the current visitor's ---------

test("a returning visitor under another name does NOT retitle the topic", async () => {
  const { transport, engine } = build()
  const first = await engine.startSession(ada)
  await flush()
  await engine.closeSession(first.sessionId)

  // Same email, different name (a returning customer typo — or someone else
  // typing a known customer's email).
  const second = await engine.startSession({ name: "Mallory", email: "ADA@example.com" })
  await flush()
  assert.equal(transport.reopened.at(-1)?.name, TITLE)

  await engine.closeSession(second.sessionId)
  assert.equal(transport.closed.at(-1)?.name, TITLE)
})

test("without getThreadSessions the engine falls back to the current session's title", async () => {
  const storage = new InMemoryStorage()
  ;(storage as { getThreadSessions?: unknown }).getThreadSessions = undefined
  const { transport, engine } = build(storage)
  const first = await engine.startSession(ada)
  await flush()
  await engine.closeSession(first.sessionId)
  await engine.startSession({ name: "Mallory", email: ada.email })
  await flush()
  assert.equal(transport.reopened.at(-1)?.name, "Mallory · ada@example.com")
})

// --- a thread shared by several chats ---------------------------------------

test("ending one chat leaves the topic unmarked while another chat on it is active", async () => {
  const { transport, engine } = build()
  const a = await engine.startSession(ada) // tab 1
  const b = await engine.startSession(ada) // tab 2, same thread
  await flush()

  await engine.closeSession(b.sessionId)
  assert.equal(transport.closed.length, 0, "A is still active — don't mark the topic done")

  await engine.closeSession(a.sessionId)
  assert.equal(transport.closed.length, 1, "last active chat ended — now mark it")
})

test("abandoning one chat honours the same guard", async () => {
  const { transport, engine } = build()
  await engine.startSession(ada)
  const b = await engine.startSession(ada)
  await flush()
  await engine.abandonSession(b.sessionId)
  assert.equal(transport.closed.length, 0)
})

test("a chat left open in a stale tab doesn't keep the topic looking active forever", async () => {
  const { storage, transport, engine } = build()
  const a = await engine.startSession(ada)
  await flush()
  // A's visitor walked away an hour ago without ending the chat.
  await storage.updateSession(a.sessionId, { lastSeenAt: Date.now() - 60 * 60_000 })

  const b = await engine.startSession(ada)
  await flush()
  await engine.closeSession(b.sessionId)
  assert.equal(transport.closed.length, 1)
})

test("closing an already-closed chat doesn't re-mark the topic", async () => {
  const { transport, engine } = build()
  const a = await engine.startSession(ada)
  await flush()
  await engine.closeSession(a.sessionId)
  await engine.closeSession(a.sessionId) // agent types /close again
  assert.equal(transport.closed.length, 1)
})

// --- topics locked by an older version --------------------------------------

test("a resumed chat unlocks its topic on the first message only (no retitle)", async () => {
  const { storage, transport, engine } = build()
  const a = await engine.startSession(ada)
  await flush()
  assert.equal(transport.reopened.length, 0, "a topic we just created can't be locked")

  // Process restart / resumed widget session: a fresh engine, same storage.
  const resumed = new ChatEngine({ storage, transport })
  await resumed.handleVisitorMessage(a.sessionId, "hello?")
  await resumed.handleVisitorMessage(a.sessionId, "anyone there?")

  assert.deepEqual(transport.reopened, [{ threadId: "1", name: undefined }])
})

test("a returning visitor's reopen already counts as unlocked", async () => {
  const { transport, engine } = build()
  const a = await engine.startSession(ada)
  await flush()
  await engine.closeSession(a.sessionId)
  const b = await engine.startSession(ada)
  await flush()
  await engine.handleVisitorMessage(b.sessionId, "hi")
  assert.equal(transport.reopened.length, 1) // startSession's, not a second one
})
