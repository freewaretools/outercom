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
