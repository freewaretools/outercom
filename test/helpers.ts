import type { ChatTransport, SendResult } from "../src/transport.ts"
import type { AIProvider, AIReply, ParsedAgentReply } from "../src/types.ts"

/**
 * Transport double. `killThread(id)` simulates an agent deleting the topic —
 * the exact production failure this suite exists for.
 */
export class FakeTransport implements ChatTransport {
  readonly created: string[] = []
  readonly sent: Array<{ threadId: string; text: string }> = []
  private readonly dead = new Set<string>()
  private nextId = 1
  /** Set to make createTopic throw (misconfigured group / missing perms). */
  createFails = false

  async createTopic(name: string): Promise<string> {
    if (this.createFails) throw new Error("createForumTopic failed")
    this.created.push(name)
    return String(this.nextId++)
  }

  async sendMessage(threadId: string, text: string): Promise<SendResult> {
    if (this.dead.has(threadId)) return { ok: false, threadGone: true }
    this.sent.push({ threadId, text })
    return { ok: true }
  }

  async closeTopic(): Promise<void> {}

  async reopenTopic(threadId: string): Promise<boolean> {
    return !this.dead.has(threadId)
  }

  parseUpdate(): ParsedAgentReply | null {
    return null
  }

  /** Simulate the topic being deleted upstream. */
  killThread(threadId: string): void {
    this.dead.add(threadId)
  }

  /** Messages relayed into a given thread. */
  sentTo(threadId: string): string[] {
    return this.sent.filter((s) => s.threadId === threadId).map((s) => s.text)
  }
}

/** AI double with a fixed reply. */
export class FakeAI implements AIProvider {
  calls = 0
  constructor(private readonly canned: AIReply = { text: "hello", escalate: false }) {}
  async reply(): Promise<AIReply> {
    this.calls++
    return this.canned
  }
}

/** Let backgrounded work in startSession settle. */
export async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}
