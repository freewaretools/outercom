/**
 * Next.js App Router adapter. Wire these into `route.ts` files:
 *
 *   // src/app/api/chat/route.ts
 *   import { routes } from "@/lib/chat/config"
 *   export const runtime = "nodejs"
 *   export const POST = routes.chat.POST
 *
 * Uses only the Web `Request`/`Response` APIs, so it isn't tied to Next beyond
 * the file convention.
 */
import { ChatSessionNotFound } from "./engine";
const DEFAULT_SECRET_HEADER = "x-telegram-bot-api-secret-token";
const DEFAULT_MAX_LEN = 4000;
export function createChatRoutes(getEngine, options = {}) {
    return {
        /** POST /api/chat — { action: "start" | "send", ... } */
        chat: { POST: (req) => handleChat(getEngine, req, options) },
        /** GET /api/chat/poll?sessionId=..&after=.. */
        poll: { GET: (req) => handlePoll(getEngine, req) },
        /** POST /api/chat/telegram — inbound transport webhook */
        webhook: { POST: (req) => handleWebhook(getEngine, req, options) },
    };
}
async function handleChat(getEngine, req, options) {
    let body;
    try {
        body = await req.json();
    }
    catch {
        return json({ error: "invalid JSON" }, 400);
    }
    const action = body?.action;
    const engine = await getEngine();
    const maxLen = options.maxMessageLength ?? DEFAULT_MAX_LEN;
    try {
        if (action === "start") {
            let visitor = normalizeVisitor(body.visitor, maxLen);
            // Server-trusted identity wins over anything the client sent.
            if (options.resolveVisitor) {
                const resolved = await options.resolveVisitor(req);
                if (!resolved)
                    return json({ error: "unauthorized" }, 401);
                visitor = {
                    name: resolved.name,
                    email: resolved.email,
                    topic: visitor?.topic,
                };
            }
            if (!visitor)
                return json({ error: "name and a valid email are required" }, 400);
            const { sessionId } = await engine.startSession(visitor);
            return json({ sessionId });
        }
        if (action === "send") {
            const { sessionId, text } = body;
            if (typeof sessionId !== "string" || !sessionId) {
                return json({ error: "sessionId required" }, 400);
            }
            if (typeof text !== "string" || !text.trim()) {
                return json({ error: "text required" }, 400);
            }
            const result = await engine.handleVisitorMessage(sessionId, text.slice(0, maxLen));
            return json({ status: result.session.status, messages: result.newMessages });
        }
        if (action === "email") {
            const { sessionId } = body;
            if (typeof sessionId !== "string" || !sessionId) {
                return json({ error: "sessionId required" }, 400);
            }
            const ok = await engine.emailTranscript(sessionId);
            return json({ ok });
        }
        if (action === "end") {
            const { sessionId } = body;
            if (typeof sessionId !== "string" || !sessionId) {
                return json({ error: "sessionId required" }, 400);
            }
            await engine.abandonSession(sessionId);
            return json({ ok: true });
        }
        return json({ error: "unknown action" }, 400);
    }
    catch (err) {
        if (err instanceof ChatSessionNotFound)
            return json({ error: "session not found" }, 404);
        console.error("[chatkit] chat route error:", err);
        return json({ error: "internal error" }, 500);
    }
}
async function handlePoll(getEngine, req) {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("sessionId");
    const after = Number(url.searchParams.get("after") ?? "0") || 0;
    if (!sessionId)
        return json({ error: "sessionId required" }, 400);
    try {
        const engine = await getEngine();
        const result = await engine.poll(sessionId, after);
        return json(result);
    }
    catch (err) {
        if (err instanceof ChatSessionNotFound)
            return json({ error: "session not found" }, 404);
        console.error("[chatkit] poll route error:", err);
        return json({ error: "internal error" }, 500);
    }
}
async function handleWebhook(getEngine, req, options) {
    if (options.webhookSecret) {
        const header = options.webhookSecretHeader ?? DEFAULT_SECRET_HEADER;
        if (req.headers.get(header) !== options.webhookSecret) {
            return json({ ok: false }, 401);
        }
    }
    let update;
    try {
        update = await req.json();
    }
    catch {
        // Always 200 so the transport doesn't retry a malformed delivery forever.
        return json({ ok: true });
    }
    try {
        const engine = await getEngine();
        await engine.handleWebhookUpdate(update);
    }
    catch (err) {
        console.error("[chatkit] webhook route error:", err);
    }
    return json({ ok: true });
}
function normalizeVisitor(input, maxLen) {
    if (!input || typeof input !== "object")
        return null;
    const { name, email, topic } = input;
    if (typeof name !== "string" || !name.trim())
        return null;
    if (typeof email !== "string" || !isEmail(email))
        return null;
    return {
        name: name.trim().slice(0, 200),
        email: email.trim().slice(0, 320),
        topic: typeof topic === "string" && topic.trim() ? topic.trim().slice(0, maxLen) : undefined,
    };
}
function isEmail(s) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
}
function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}
