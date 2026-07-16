# Changelog

All notable changes to `@freewaretools/outercom`.

This project adheres to [Semantic Versioning](https://semver.org/). While the
major version is `0`, breaking changes ship in minor releases.

## [0.5.1] — 2026-07-16

Fixes four defects an adversarial review found in 0.5.0, each reproduced by a
probe and now covered by a regression test. No API change.

### Fixed

- **The AI could talk over a live human.** `maybeResumeAi`'s "has an agent
  replied?" guard was **session**-scoped, but agents reply into a **thread**, and
  threads are deliberately shared across sessions (`getThreadByEmail` reuse). An
  inbound reply is recorded only against the session that owns the thread, so any
  *other* live session on that thread saw zero agent messages and would resume —
  posting AI replies into a topic a human was actively working. Resuming now
  additionally requires that the session still owns its thread.
- **`abandonSession` resurrected deleted topics.** Its departure notice relayed
  through `mirror()`, so a deleted topic was recreated, told "this chat continues
  here" (it doesn't — the next statements close it), then immediately closed. In
  the very scenario 0.5.0 targets (someone tidying up topics), every abandoned
  session spawned a fresh topic. Terminal notices now use `mirror(..., {revive:
  false})`.
- **The `startSession` intro was the one send that couldn't heal.** It called
  `transport.sendMessage` directly and discarded the `SendResult`, so a
  `threadGone` there was dropped and the session was persisted onto the dead
  thread. Harmless for `TelegramTransport` (whose `reopenTopic` catches a deleted
  topic first, leaving only a narrow race), but systematic for any transport that
  returns `true` from `reopenTopic` because it has no reopen concept — which the
  interface explicitly permits. It now routes through `mirror()`.
- **A synchronous storage throw permanently disabled revival.** The in-flight
  dedupe entry was installed *after* the async IIFE was invoked, and an IIFE runs
  synchronously up to its first `await`. A storage adapter throwing synchronously
  (an ordinary guard-clause pattern) therefore ran `finally`'s `delete` before the
  `set`, leaving a resolved-`null` promise cached forever — so every later revive
  for that session returned `null` and dropped the message, resurrecting the
  original bug. The task is now deferred by a microtask so the entry is installed
  first. Latent for both Prisma-backed consumers (async, so they reject rather
  than throw).

## [0.5.0] — 2026-07-16

### Fixed

- **A deleted transport topic no longer kills the conversation silently.**
  Topics are reused per visitor email indefinitely, so once a topic was deleted
  upstream every relay failed with `Bad Request: message thread not found` — and
  because sends are best-effort, nothing surfaced. The chat looked alive while
  every message to the team vanished. The engine now recognises a dead thread,
  recreates it, persists the new id, and retries the message. A returning
  visitor whose remembered topic was deleted gets a fresh one instead of being
  pinned to the dead id. Concurrent messages share a single revival, so a burst
  can't mint duplicate topics.

- **Escalating no longer strands a visitor when nobody is watching.** `live` was
  a one-way door: if no agent ever replied — because the transport was
  misconfigured, or nobody was looking — the AI stayed silent forever and the
  visitor got nothing. See `aiResumeAfterMs` below.

### Changed

- **AI prompt: don't escalate on gibberish.** An unclear message, stray
  keystroke, or empty input now gets a warm "could you rephrase?" instead of
  burning a human handoff. Escalation is reserved for real questions.

### Added

- `ChatEngineOptions.aiResumeAfterMs` (default `10 * 60_000`, `0` disables) —
  how long an escalated chat may sit unanswered before the AI picks it back up.
  Only ever fires when **no** agent has replied in that session, so it cannot
  cut in on a human who is simply typing slowly.
- `TelegramApiError` and `isThreadGone(err)` — exported so hosts can classify
  Bot API failures. `isThreadGone` is deliberately narrow: `TOPIC_NOT_MODIFIED`,
  `chat not found` and auth errors all leave the topic intact.
- A test suite (`npm test`), using Node's built-in runner via `tsx`.

### Breaking

Only relevant if you implement `ChatTransport` yourself; `TelegramTransport`
users are unaffected beyond the version bump.

- `ChatTransport.sendMessage` returns `Promise<SendResult>` (was
  `Promise<void>`). Return `{ ok: true }` on success. Return
  `{ ok: false, threadGone: true }` when the thread no longer exists to opt into
  recreate-and-retry; leave `threadGone` unset to keep the old behaviour.
- `ChatTransport.reopenTopic` returns `Promise<boolean>` (was `Promise<void>`).
  Return `false` **only** when the thread is gone — `true` if it reopened, was
  already open, or the concept doesn't apply. Returning `false` on a transient
  error will spawn duplicate threads.

In practice an un-migrated JavaScript transport keeps working: the engine only
acts on an explicit `threadGone: true` / `reopenTopic() === false`, so the
`undefined` a void-returning transport yields is read as "delivered" and
"alive" — exactly the pre-0.5 behaviour. TypeScript users get a compile error
and should adopt the new returns to gain self-healing.

## [0.4.0]

- Relicensed MIT and moved to the public `@freewaretools/outercom` on npm
  (formerly the private `@lowvoltage/outercom`). No functional changes.

## [0.3.0]

- Menu-launched mode + server-trusted identity (`resolveVisitor`).

## [0.2.0]

- Offline-reply email + config-driven theming.

## [0.1.0]

- Initial release.
