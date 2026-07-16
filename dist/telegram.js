/** A non-ok response from the Bot API, carrying Telegram's own `description`. */
export class TelegramApiError extends Error {
    constructor(method, description, status) {
        super(`Telegram ${method} failed: ${description || status}`);
        this.method = method;
        this.description = description;
        this.status = status;
        this.name = "TelegramApiError";
    }
}
/**
 * Does this error mean the topic itself is gone (someone deleted it)?
 *
 * Deliberately narrow. `TOPIC_NOT_MODIFIED` (already open), `chat not found`
 * (wrong group id) and auth errors all leave the topic intact — treating those
 * as "gone" would spawn a duplicate topic on every transient hiccup.
 */
export function isThreadGone(err) {
    if (!(err instanceof TelegramApiError))
        return false;
    return /message thread not found|TOPIC_DELETED/i.test(err.description);
}
/**
 * Telegram transport. v1 of chatkit's "human handoff" surface — designed
 * behind a thin interface so other transports (Slack, Discord, email) can be
 * added later without touching the engine.
 *
 * Each chat session gets its own forum topic; the agent replies inside that
 * topic and the webhook maps `message_thread_id` back to the session.
 */
export class TelegramTransport {
    constructor(cfg) {
        this.cfg = cfg;
    }
    async call(method, body) {
        const res = await fetch(`https://api.telegram.org/bot${this.cfg.botToken}/${method}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: this.cfg.chatId, ...body }),
        });
        const data = (await res.json().catch(() => ({})));
        if (!data.ok) {
            throw new TelegramApiError(method, data.description ?? "", res.status);
        }
        return data.result;
    }
    /** Create a forum topic and return its `message_thread_id` (as a string). */
    async createTopic(name) {
        // Telegram truncates topic names at 128 chars.
        const result = await this.call("createForumTopic", { name: name.slice(0, 128) });
        return String(result.message_thread_id);
    }
    /** Post a message into a topic. Best-effort: never throws to the caller. */
    async sendMessage(threadId, text) {
        try {
            await this.call("sendMessage", {
                message_thread_id: Number(threadId),
                text,
                parse_mode: "HTML",
                disable_web_page_preview: true,
            });
            return { ok: true };
        }
        catch (err) {
            // A deleted topic isn't an error worth logging here — the engine recreates
            // the thread and says so. Everything else is a genuine failure.
            if (isThreadGone(err))
                return { ok: false, threadGone: true };
            console.error("[chatkit] telegram sendMessage failed:", err);
            return { ok: false };
        }
    }
    /** Close a topic when a conversation ends (keeps the group tidy). */
    async closeTopic(threadId) {
        try {
            await this.call("closeForumTopic", { message_thread_id: Number(threadId) });
        }
        catch (err) {
            console.error("[chatkit] telegram closeForumTopic failed:", err);
        }
    }
    /**
     * Reopen a closed topic (so a returning visitor reuses the same thread).
     * Returns false only if the topic has been deleted, so the caller knows to
     * create a new one instead of writing into a thread that no longer exists.
     */
    async reopenTopic(threadId) {
        try {
            await this.call("reopenForumTopic", { message_thread_id: Number(threadId) });
            return true;
        }
        catch (err) {
            // Already open (TOPIC_NOT_MODIFIED) and transient errors both mean the
            // topic is still there; only a deleted one warrants a replacement.
            return !isThreadGone(err);
        }
    }
    /**
     * Parse an inbound webhook update into an agent reply, or `null` if it isn't
     * a relevant human message. Bots don't receive their own messages, so AI/bot
     * echoes never come back through here. Service messages (topic created, etc.)
     * and non-topic chatter are ignored.
     */
    parseUpdate(update) {
        const msg = update?.message;
        if (!msg)
            return null;
        if (msg.message_thread_id == null)
            return null; // not inside a topic
        if (msg.from?.is_bot)
            return null;
        if (msg.forum_topic_created || msg.forum_topic_closed)
            return null;
        const text = (msg.text ?? msg.caption ?? "").trim();
        if (!text)
            return null;
        const fromName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") ||
            msg.from?.username;
        const threadId = String(msg.message_thread_id);
        const lower = text.toLowerCase();
        if (lower === "/close" || lower === "/end") {
            return { threadId, text, fromName, command: "close" };
        }
        return { threadId, text, fromName };
    }
}
