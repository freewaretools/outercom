import { test } from "node:test"
import assert from "node:assert/strict"
import { ChatEngine } from "../src/engine.ts"
import { InMemoryStorage } from "../src/storage.ts"
import type { ChatTransport } from "../src/transport.ts"
import { FakeAI, flush } from "./helpers.ts"

/**
 * A transport written against the pre-0.5 contract: `sendMessage` and
 * `reopenTopic` both resolve to `undefined`. The engine must degrade to the old
 * best-effort behaviour rather than misread `undefined` as "thread gone" — that
 * would recreate a topic on every returning visitor.
 */
class LegacyTransport implements ChatTransport {
  created: string[] = []
  sent: string[] = []
  private next = 1

  async createTopic(name: string): Promise<string> {
    this.created.push(name)
    return String(this.next++)
  }
  // @ts-expect-error — deliberately the old void-returning signature.
  async sendMessage(_threadId: string, text: string): Promise<void> {
    this.sent.push(text)
  }
  async closeTopic(): Promise<void> {}
  // @ts-expect-error — deliberately the old void-returning signature.
  async reopenTopic(): Promise<void> {}
  parseUpdate() {
    return null
  }
}

const visitor = { name: "Ada", email: "ada@example.com" }

test("a void-returning transport still relays without recreating topics", async () => {
  const storage = new InMemoryStorage()
  const transport = new LegacyTransport()
  const engine = new ChatEngine({ storage, transport, ai: new FakeAI() })

  const { sessionId } = await engine.startSession(visitor)
  await flush()
  await engine.handleVisitorMessage(sessionId, "hello")

  assert.equal(transport.created.length, 1)
  assert.ok(transport.sent.some((t) => t.includes("hello")))
})

test("a void-returning reopenTopic is read as alive, not gone", async () => {
  const storage = new InMemoryStorage()
  const transport = new LegacyTransport()
  const engine = new ChatEngine({ storage, transport, ai: new FakeAI() })

  await engine.startSession(visitor)
  await flush()
  await engine.startSession(visitor) // same email returns
  await flush()

  assert.equal(
    transport.created.length,
    1,
    "returning visitor must reuse the remembered topic"
  )
})
