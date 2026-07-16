# Changelog

All notable changes to `@freewaretools/outercom`.

This project adheres to [Semantic Versioning](https://semver.org/). While the
major version is `0`, breaking changes ship in minor releases.

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
