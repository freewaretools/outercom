import { test } from "node:test"
import assert from "node:assert/strict"
import { TelegramApiError, isThreadGone } from "../src/telegram.ts"

const err = (description: string) =>
  new TelegramApiError("sendMessage", description, 400)

test("isThreadGone: true for a deleted topic", () => {
  // The exact description prod returned once the topics were cleaned up.
  assert.equal(isThreadGone(err("Bad Request: message thread not found")), true)
  assert.equal(isThreadGone(err("TOPIC_DELETED")), true)
})

test("isThreadGone: false for errors that leave the topic intact", () => {
  // Reopening an already-open topic must NOT be read as "deleted", or every
  // returning visitor would get a needless duplicate topic.
  assert.equal(isThreadGone(err("Bad Request: TOPIC_NOT_MODIFIED")), false)
  // A wrong group id is a config bug; recreating would fail anyway.
  assert.equal(isThreadGone(err("Bad Request: chat not found")), false)
  assert.equal(isThreadGone(err("Unauthorized")), false)
  assert.equal(isThreadGone(err("Too Many Requests: retry after 5")), false)
})

test("isThreadGone: false for non-Telegram errors", () => {
  assert.equal(isThreadGone(new Error("message thread not found")), false)
  assert.equal(isThreadGone(new TypeError("fetch failed")), false)
  assert.equal(isThreadGone(undefined), false)
  assert.equal(isThreadGone(null), false)
})

test("TelegramApiError keeps Telegram's description readable", () => {
  const e = err("Bad Request: message thread not found")
  assert.equal(e.name, "TelegramApiError")
  assert.equal(e.description, "Bad Request: message thread not found")
  assert.equal(e.status, 400)
  assert.match(e.message, /message thread not found/)
})

// --- close / reopen -------------------------------------------------------

import { TelegramTransport } from "../src/telegram.ts"

type Call = { method: string; body: Record<string, unknown> }

/** fetch double: records Bot API calls; `fail` maps a method to an error description. */
function fakeFetch(fail: Record<string, string> = {}) {
  const calls: Call[] = []
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const method = String(url).split("/").pop() as string
    calls.push({ method, body: JSON.parse(String(init?.body)) })
    const description = fail[method]
    const body = description ? { ok: false, description } : { ok: true, result: true }
    return new Response(JSON.stringify(body), { status: description ? 400 : 200 })
  }) as typeof fetch
  return { calls, impl }
}

const make = (extra: Partial<ConstructorParameters<typeof TelegramTransport>[0]> = {}, fail = {}) => {
  const f = fakeFetch(fail)
  return { f, t: new TelegramTransport({ botToken: "x", chatId: -100, fetch: f.impl, ...extra }) }
}

test("closeTopic (default): renames with a prefix and does NOT lock the topic", async () => {
  const { f, t } = make()
  await t.closeTopic("7", "Ann · ann@x.nz")
  assert.deepEqual(f.calls.map((c) => c.method), ["editForumTopic"])
  assert.equal(f.calls[0].body.name, "✅ Ann · ann@x.nz")
  assert.equal(f.calls[0].body.message_thread_id, 7)
})

test("closeTopic (default): no name → nothing to rename, no calls", async () => {
  const { f, t } = make()
  await t.closeTopic("7")
  assert.equal(f.calls.length, 0)
})

test("closeTopic: custom prefix, and 128-char cap", async () => {
  const { f, t } = make({ closedPrefix: "[done] " })
  await t.closeTopic("7", "n".repeat(200))
  assert.equal((f.calls[0].body.name as string).length, 128)
  assert.ok((f.calls[0].body.name as string).startsWith("[done] "))
})

test("closeTopic: an already-renamed topic (TOPIC_NOT_MODIFIED) is not an error", async () => {
  const { t } = make({}, { editForumTopic: "Bad Request: TOPIC_NOT_MODIFIED" })
  await t.closeTopic("7", "Ann") // must not throw
})

test("closeTopic ('lock'): legacy closeForumTopic, no rename", async () => {
  const { f, t } = make({ closeStyle: "lock" })
  await t.closeTopic("7", "Ann")
  assert.deepEqual(f.calls.map((c) => c.method), ["closeForumTopic"])
})

test("reopenTopic (default): unlocks legacy-closed topics, then restores the plain name", async () => {
  const { f, t } = make()
  assert.equal(await t.reopenTopic("7", "Ann · ann@x.nz"), true)
  assert.deepEqual(f.calls.map((c) => c.method), ["reopenForumTopic", "editForumTopic"])
  assert.equal(f.calls[1].body.name, "Ann · ann@x.nz")
})

test("reopenTopic: already-open + already-named topic still counts as alive", async () => {
  const { t } = make(
    {},
    {
      reopenForumTopic: "Bad Request: TOPIC_NOT_MODIFIED",
      editForumTopic: "Bad Request: TOPIC_NOT_MODIFIED",
    }
  )
  assert.equal(await t.reopenTopic("7", "Ann"), true)
})

test("reopenTopic: a deleted topic reports false (from either call)", async () => {
  const gone = "Bad Request: message thread not found"
  assert.equal(await make({}, { reopenForumTopic: gone }).t.reopenTopic("7", "Ann"), false)
  assert.equal(await make({}, { editForumTopic: gone }).t.reopenTopic("7", "Ann"), false)
})

test("reopenTopic: transient failures don't read as deleted", async () => {
  const { t } = make({}, { reopenForumTopic: "Too Many Requests: retry after 5" })
  assert.equal(await t.reopenTopic("7", "Ann"), true)
})

test("reopenTopic ('lock'): only reopenForumTopic", async () => {
  const { f, t } = make({ closeStyle: "lock" })
  assert.equal(await t.reopenTopic("7", "Ann"), true)
  assert.deepEqual(f.calls.map((c) => c.method), ["reopenForumTopic"])
})
