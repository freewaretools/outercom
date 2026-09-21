# Changelog

All notable changes to `@freewaretools/outercom`.

This project adheres to [Semantic Versioning](https://semver.org/). While the
major version is `0`, breaking changes ship in minor releases.

## [0.6.1] — 2026-09-22

Fixes found in an adversarial review of 0.6.0's rename-instead-of-close change.

### Fixed

- **A returning visitor could retitle the shared topic.** Topics are shared per
  email, but reopen/close rebuilt the title from whatever name the *current*
  visitor typed — so a customer typing a different name, or anyone typing a
  known customer's email, renamed that customer's topic. The title is now always
  the one the topic was **created** with (the earliest session on the thread).
- **Ending one chat marked a topic done while another chat on it was live.** Two
  tabs / devices on the same email share a thread; closing or abandoning one put
  the ✅ on it, and nothing cleared it until the next new chat. The thread is now
  left unmarked while another chat on it is active (not closed, and seen within
  `activeWithinMs`, default 10 min — chats left open in an idle tab don't count).
- **Topics locked by an older version stayed locked for resumed chats.** Only
  `startSession` ever reopened a topic, so a resumed chat kept posting into a
  locked topic that non-admin agents couldn't answer. The first visitor message
  on a thread in each process now unlocks it (unlock only — it never retitles).
- **Rights failures were invisible.** A `reopenForumTopic` error other than
  "deleted" / `TOPIC_NOT_MODIFIED` (typically the bot lacking *Manage Topics*)
  was swallowed. It is now logged.
- **Re-closing an already-closed chat re-marked the topic** — a wasted API call,
  and it could re-mark a topic a newer chat had since reopened.
- **A topic name cut at 128 units could split an emoji** into a lone surrogate,
  which Telegram rejects (leaving the topic unrenamed). Cuts now respect
  surrogate pairs (`clipTopicName`).
- `closeTopic` in rename mode with no name now logs a warning instead of doing
  nothing silently.

### Changed

- `reopenTopic` runs `reopenForumTopic` and the rename **concurrently** (it sits
  on the "Start chat" path), instead of one after the other.

### Added

- **`ChatStorage.getThreadSessions?(threadId)`** — optional; every session that
  has used a thread, any status. Powers the stable title and the shared-thread
  guard above. No schema change (`WHERE thread_id = ?`); `InMemoryStorage`
  implements it. Adapters that don't keep the 0.6.0 behaviour (title from the
  current visitor, mark on any close), so **implement it in your Prisma adapter**.
- `ChatEngineOptions.activeWithinMs`.

### Note

Rename mode owns the topic title: a title an agent edits by hand is reset to the
canonical one the next time the chat is closed or reopened. Use
`closeStyle: "lock"` (all agents must then be group admins) if that matters.

## [0.6.0] — 2026-09-22

### Changed

- **Finished chats are marked by renaming the Telegram topic, not by locking it.**
  Telegram makes a *closed* topic read-only for anyone who isn't a group admin,
  so support agents who weren't admins could neither see nor answer a returning
  visitor's chat, while admins saw it reopened fine. Closing a chat now prefixes
  the topic name with `✅ ` and leaves the topic open; a returning visitor
  restores the plain name. Because topics are shared per visitor email, this also
  stops one finished session from locking the topic under another live one.
  - `TelegramConfig.closeStyle: "lock"` restores the old behaviour;
    `closedPrefix` changes the marker.
  - Topics already locked by an earlier version are unlocked on the visitor's
    next return (the reopen path still calls `reopenForumTopic`), so no migration
    is needed.
  - Behaviour change, hence a minor bump: a `^0.5.x` range won't pick it up.

### Added

- `ChatTransport.closeTopic` / `reopenTopic` take an optional topic `name`
  (Telegram can't read a topic's name back, so the engine supplies it).
  Existing transports that ignore the argument keep working.
- `TelegramConfig.fetch` — inject a `fetch` (tests, proxies).

## [0.5.2] — 2026-07-28

### Fixed

- **A truncated AI reply could leak the raw JSON envelope to the visitor.**
  Providers ask the model for a `{"reply", "escalate", "reason"}` envelope and
  `parseAIReply` extracts `reply` from it. If the response was cut off (e.g. by
  the token limit) before the JSON object closed, `extractJsonObject` correctly
  found nothing, but the leaked-control-text safety net only checked for
  `escalate`/`reason` — not `reply` — so the unclosed `{"reply": "..."` scaffold
  fell through and was shown to the visitor verbatim instead of triggering a
  clean escalation. `looksLikeControlLeak` now also matches a leaked `reply`
  field.

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
