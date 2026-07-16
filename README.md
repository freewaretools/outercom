# @freewaretools/outercom

A small, self-hosted **live-chat widget that hands off to the messenger your team already uses**. Telegram in v1 (a forum **topic per customer**), with an optional **Claude or local-LLM** first-line that answers common questions and escalates to a human when it can't.

No SaaS, no per-seat fees — you own the data and the code.

> **Status:** in production. Portable by design — the package has **no host-app imports** and **no brand baked in** (the brand name, AI label, knowledge base, and theming are all injected by the host); persistence, transport, and AI are pluggable interfaces. Open-source under the MIT license.

## Install

From npm:

```bash
npm i @freewaretools/outercom
```

Or straight from GitHub (git-URL install — `dist/` is committed, so no build step):

```bash
npm i github:freewaretools/outercom#v0.4.0
```

Peer deps (install whichever you use): `react` (for the widget), `@anthropic-ai/sdk` (only if you use the Claude provider — it's lazy-loaded, so local-LLM / human-only setups don't need it).

Entry points: `@freewaretools/outercom` (core), `@freewaretools/outercom/react` (widget), `@freewaretools/outercom/next` (App Router route factories).

## How it works

```
Visitor ──► ChatWidget ──► /api/chat ──► ChatEngine ──┬─► AIProvider (Claude / local, first-line)
   ▲                                                  └─► ChatTransport (Telegram topic)
   │                                                            │
   └──────────── /api/chat/poll ◄── ChatStorage ◄── /api/chat/telegram (agent reply webhook)
```

1. The widget collects **name + email** (+ optional question) before any messaging.
2. On start, the engine reuses (or opens) a **forum topic per customer** named `Name · email` and posts the details.
3. The AI answers first-line from your knowledge base; if it can't, it **escalates** (pings the topic, tells the visitor a human is coming).
4. An agent replies **inside the topic** → the webhook maps `message_thread_id` → session → the visitor sees it on the next poll. The AI goes quiet once a human joins.

## Architecture (the seams)

| Piece | Interface | Ships | Swap for… |
|---|---|---|---|
| Persistence | `ChatStorage` | `InMemoryStorage` (dev only) | a Postgres/Prisma adapter (the host provides one) |
| Handoff | `ChatTransport` | `TelegramTransport` | `SlackTransport`, `DiscordTransport`, email… |
| First-line AI | `AIProvider` | `AnthropicProvider` (Claude Haiku 4.5) · `LocalProvider` (any OpenAI-compatible server) | any LLM, or omit for human-only |

Thread ids are **opaque strings**, so a transport's native id fits as-is (Telegram `message_thread_id`, Slack `thread_ts`, …).

## Quick start (Next.js App Router)

```ts
// build the engine once (host app supplies storage + secrets)
import { ChatEngine, TelegramTransport, AnthropicProvider, renderTranscript } from "@freewaretools/outercom"
import { createChatRoutes } from "@freewaretools/outercom/next"
import { PrismaChatStorage } from "@/lib/chat/prisma-storage"
import { sendEmail } from "@/lib/email"

const engine = new ChatEngine({
  storage: new PrismaChatStorage(),
  transport: new TelegramTransport({ botToken: TOKEN, chatId: GROUP_ID }),
  ai: new AnthropicProvider({ apiKey: KEY, knowledgeBase: KB, brand: "Acme" }),
  topicName: (v) => `${v.name} · ${v.email}`,
  sendTranscript: async (session, messages) => {
    const { subject, html, text } = renderTranscript(session, messages, { brand: "Acme" })
    await sendEmail({ to: session.visitor.email, subject, html, text })
  },
})

export const routes = createChatRoutes(() => engine, { webhookSecret: SECRET })
```

```ts
// src/app/api/chat/route.ts
import { routes } from "@/lib/chat/config"
export const runtime = "nodejs"
export const POST = routes.chat.POST
```

…and likewise `app/api/chat/poll/route.ts` → `routes.poll.GET`, `app/api/chat/telegram/route.ts` → `routes.webhook.POST`.

```tsx
// mount the widget — self-gates via a runtime config route so on/off isn't baked into a build
import { ChatWidget } from "@freewaretools/outercom/react"
<ChatWidget configUrl="/api/chat/config" title="Live Chat" accentColor="#0f172a" />
```

## Features

- **Topic-per-customer** — reused (and reopened) by email, so one thread per person, not a pile of duplicates. **Self-healing**: if someone deletes the topic, the next message recreates it and carries on, instead of relaying into the void.
- **AI first-line** — Claude (`AnthropicProvider`, default Haiku 4.5) or any OpenAI-compatible local model (`LocalProvider`: Ollama / LM Studio / llama.cpp / vLLM). Same persona + `{reply, escalate, reason}` contract, defensive JSON parsing with plain-text fallback.
- **No dead ends** — an escalation that no agent answers within `aiResumeAfterMs` (default 10 min) falls back to the AI, so a visitor is never left in silence. Never fires once a human has replied.
- **Agent names** — the replying staff member's name is shown on their bubbles.
- **Transcript email** — auto-sent on close, plus an "Email me a copy" button (`renderTranscript` + a host `sendTranscript` hook).
- **Notification sounds** — soft Web-Audio "boop" on incoming replies, with mute toggle + unread dot on the launcher.
- **Reset/abandon** — visitor reset posts a notice into the topic and closes it, so agents don't reply into a dead chat.

## AI: cloud or local

```ts
// Cloud — Claude Haiku 4.5 (cheapest tier)
new AnthropicProvider({ apiKey, knowledgeBase, brand: "Acme" })

// Local — anything speaking the OpenAI Chat Completions API
new LocalProvider({
  baseUrl: "http://192.168.x.x:11434/v1", // Ollama; LM Studio :1234, llama.cpp :8080, vLLM :8000
  model: "gemma3:12b",
  knowledgeBase,
  brand: "Acme",
})
```

A local model keeps all chat data on your own infrastructure with no per-token cost. From inside Docker, point `baseUrl` at the LAN IP / `host.docker.internal`, not `localhost`, and bind the model server to `0.0.0.0`.

## Telegram setup

1. **@BotFather → `/newbot`** → copy the token (a *dedicated* bot — a bot can only have one webhook URL).
2. Create a **group**, make it a **forum** (Group → Edit → *Topics* on).
3. Add the bot as **admin** — and crucially enable the **Manage Topics** admin right (being an admin alone isn't enough to create topics).
4. Get the group's chat id (negative `-100…`); confirm with `getChat` → `is_forum: true`.
5. Register the webhook with a secret:
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://yoursite/api/chat/telegram&secret_token=<SECRET>"
   ```

## Extending: Slack (or anything)

Implement `ChatTransport` and pass it to the engine — no engine changes:

```ts
class SlackTransport implements ChatTransport {
  createTopic(name) { /* post a parent message → return its thread_ts */ }
  // → SendResult. Best-effort: report failure, don't throw. Set `threadGone`
  //   when the thread no longer exists and the engine should mint a new one.
  sendMessage(threadId, text) { /* chat.postMessage thread_ts=threadId */ }
  closeTopic(threadId) { /* archive / post a "closed" note */ }
  // → boolean. false ONLY when the thread is gone; true if reopened, already
  //   open, or the concept doesn't apply. Returning false on a transient error
  //   would spawn duplicate threads.
  reopenTopic(threadId) { /* optional → return true */ }
  parseUpdate(evt) { /* Events API message in a thread → { threadId, text } */ }
}
```

A transport that can't distinguish "thread deleted" from other failures should
just leave `threadGone` unset — the engine then behaves as it did before
(best-effort send, no recreate).

## Notes

- **Storage must be durable in prod** — agent replies arrive asynchronously; sessions must survive cold starts / multiple instances. Use a Postgres adapter, not `InMemoryStorage`.
- **Delivery to the visitor is poll-based** (robust + serverless-friendly). SSE is a possible upgrade.
- **Rate limiting / spam protection** on `/api/chat` is the host's responsibility.
- The session id is an unguessable UUID held by the client; it grants access to that session only. For authenticated apps, derive the visitor server-side rather than trusting the client.

## Tests

`npm test` — Node's built-in runner over `test/*.test.ts`, loaded through `tsx`.
Tests exercise `src/` directly and are outside tsconfig's `include`, so they
never reach `dist/`.

## Releasing

`dist/` is committed so git-URL installs need no build step. To cut a release: `npm test`, `npm run build`, commit `dist/`, tag (`git tag v0.x.0 && git push --tags`), then `npm publish`. Consumers use `npm i @freewaretools/outercom` or pin `github:freewaretools/outercom#v0.x.0`.

---

MIT — see [LICENSE](./LICENSE).
