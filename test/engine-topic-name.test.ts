import { test } from "node:test"
import assert from "node:assert/strict"
import { ChatEngine } from "../src/engine.ts"
import { InMemoryStorage } from "../src/storage.ts"
import { FakeTransport, FakeAI, flush } from "./helpers.ts"

const visitor = { name: "Ada", email: "ada@example.com" }
const NAME = "Ada · ada@example.com"

function build() {
  const storage = new InMemoryStorage()
  const transport = new FakeTransport()
  const engine = new ChatEngine({ storage, transport, ai: new FakeAI() })
  return { transport, engine }
}

// Telegram can't read a topic's name back, so the engine must hand it over for
// the transport to rename close → reopen.

test("closeSession passes the topic name so the transport can rename it", async () => {
  const { transport, engine } = build()
  const { sessionId } = await engine.startSession(visitor)
  await flush()
  await engine.closeSession(sessionId)
  assert.deepEqual(transport.closed, [{ threadId: "1", name: NAME }])
})

test("abandonSession passes the topic name too", async () => {
  const { transport, engine } = build()
  const { sessionId } = await engine.startSession(visitor)
  await flush()
  await engine.abandonSession(sessionId)
  assert.deepEqual(transport.closed, [{ threadId: "1", name: NAME }])
})

test("a returning visitor reopens the SAME topic with its plain name", async () => {
  const { transport, engine } = build()
  const first = await engine.startSession(visitor)
  await flush()
  await engine.closeSession(first.sessionId)

  await engine.startSession(visitor)
  await flush()
  assert.equal(transport.created.length, 1) // reused, not recreated
  assert.deepEqual(transport.reopened, [{ threadId: "1", name: NAME }])
})
