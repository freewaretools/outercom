const DEFAULT_ESCALATION = "I've passed this to our team — someone will jump in here shortly. Feel free to add any extra detail in the meantime.";
/** Messages the client should render (everything except the visitor's own echoes). */
const CLIENT_ROLES = ["ai", "agent", "system"];
/**
 * Orchestrates a conversation across the storage, Telegram transport, and the
 * optional AI first-line. Transport-agnostic at heart — `transport` is the only
 * Telegram-specific dependency and sits behind a small surface.
 */
export class ChatEngine {
    constructor(opts) {
        this.storage = opts.storage;
        this.transport = opts.transport;
        this.ai = opts.ai;
        this.aiEnabled = (opts.aiEnabled ?? true) && !!opts.ai;
        this.topicName =
            opts.topicName ?? ((v) => `${v.name} · ${v.email}`);
        this.escalationMessage = opts.escalationMessage ?? DEFAULT_ESCALATION;
        this.sendTranscript = opts.sendTranscript;
        this.sendReplyNotification = opts.sendReplyNotification;
    }
    /** Email the visitor a transcript on demand. Returns false if no mailer is wired. */
    async emailTranscript(sessionId) {
        if (!this.sendTranscript)
            return false;
        const session = await this.storage.getSession(sessionId);
        if (!session)
            return false;
        try {
            const messages = await this.storage.getMessages(sessionId);
            await this.sendTranscript(session, messages);
            return true;
        }
        catch (err) {
            console.error("[chatkit] sendTranscript failed:", err);
            return false;
        }
    }
    /**
     * Start a new chat: create the session, open a Telegram topic, and post the
     * captured visitor details. The pre-chat form has already collected name +
     * email (+ optional question) so a topic-per-chat is created up front.
     */
    async startSession(visitor) {
        const id = crypto.randomUUID();
        const now = Date.now();
        // Reuse one topic per customer email; reopen it if a prior chat closed it.
        let threadId = await this.storage.getThreadByEmail(visitor.email);
        const reused = threadId !== null;
        if (threadId !== null) {
            await this.transport.reopenTopic(threadId);
        }
        else {
            try {
                threadId = await this.transport.createTopic(this.topicName(visitor));
            }
            catch (err) {
                // If topic creation fails (misconfigured group/perms), the chat still
                // works AI-only; agent relay just won't be available until fixed.
                console.error("[chatkit] could not create transport thread:", err);
                threadId = null;
            }
        }
        const session = {
            id,
            visitor,
            threadId,
            status: this.aiEnabled ? "ai" : "live",
            createdAt: now,
            updatedAt: now,
        };
        await this.storage.createSession(session);
        // Post the Telegram intro + handle the opening question in the BACKGROUND so
        // "Start chat" returns immediately. Awaiting these blocked the widget on two
        // Telegram round-trips plus the full AI generation. The widget shows the
        // opening message optimistically and the AI reply arrives via poll().
        void (async () => {
            try {
                if (threadId != null) {
                    const header = reused
                        ? "🔁 <b>Returning visitor — new chat</b>"
                        : "🆕 <b>New chat</b>";
                    const intro = `${header}\n` +
                        `From: ${esc(visitor.name)} (${esc(visitor.email)})\n` +
                        (visitor.topic ? `Topic: ${esc(visitor.topic)}\n` : "") +
                        (this.aiEnabled
                            ? `\nThe AI assistant is handling this. Reply in this topic to take over.`
                            : `\nReply in this topic to respond.`);
                    await this.transport.sendMessage(threadId, intro);
                }
                // The pre-chat question becomes the visitor's opening message.
                if (visitor.topic) {
                    await this.handleVisitorMessage(id, visitor.topic);
                }
            }
            catch (err) {
                console.error("[chatkit] post-start tasks failed:", err);
            }
        })();
        return { sessionId: id };
    }
    /**
     * Handle a visitor message: persist + mirror to Telegram, then (if the AI is
     * handling) generate a reply. Returns any new client-facing messages produced
     * synchronously (the AI reply / escalation note) so the widget can render
     * them immediately; async agent replies arrive via {@link poll}.
     */
    async handleVisitorMessage(sessionId, text) {
        const session = await this.requireSession(sessionId);
        const clean = text.trim();
        if (!clean)
            return { session, newMessages: [] };
        await this.append(session, "visitor", clean);
        await this.mirror(session, `💬 <b>${esc(session.visitor.name)}:</b> ${esc(clean)}`);
        const produced = [];
        if (session.status === "ai" && this.aiEnabled && this.ai) {
            try {
                const history = await this.storage.getMessages(sessionId);
                const ai = await this.ai.reply(history, session.visitor);
                if (ai.escalate) {
                    await this.mirror(session, `🙋 <b>AI requested a human</b>${ai.reason ? ` — ${esc(ai.reason)}` : ""}`);
                    const note = await this.append(session, "system", this.escalationMessage);
                    produced.push(note);
                    await this.storage.updateSession(sessionId, { status: "live" });
                }
                else {
                    const reply = await this.append(session, "ai", ai.text);
                    produced.push(reply);
                    await this.mirror(session, `🤖 <b>AI:</b> ${esc(ai.text)}`);
                }
            }
            catch (err) {
                console.error("[chatkit] AI reply failed, escalating:", err);
                const note = await this.append(session, "system", this.escalationMessage);
                produced.push(note);
                await this.storage.updateSession(sessionId, { status: "live" });
                await this.mirror(session, `⚠️ <b>AI error — needs a human.</b>`);
            }
        }
        return { session: await this.requireSession(sessionId), newMessages: produced };
    }
    /**
     * Handle an inbound Telegram webhook update — a human agent replying in a
     * topic. Flips the session to `live` so the AI stays quiet, or closes it on
     * `/close`. Returns true if the update mapped to a known session.
     */
    async handleWebhookUpdate(update) {
        const parsed = this.transport.parseUpdate(update);
        if (!parsed)
            return false;
        const session = await this.storage.getSessionByThread(parsed.threadId);
        if (!session)
            return false;
        if (parsed.command === "close") {
            await this.closeSession(session.id);
            return true;
        }
        await this.append(session, "agent", parsed.text, parsed.fromName);
        if (session.status !== "live") {
            await this.storage.updateSession(session.id, { status: "live" });
        }
        return true;
    }
    /**
     * Poll for messages the visitor hasn't seen yet, plus the live status. Also
     * records the visitor as "seen" now (a present visitor is polling/heartbeating)
     * — the disconnect detector keys off this.
     */
    async poll(sessionId, after = 0) {
        const session = await this.requireSession(sessionId);
        const messages = await this.storage.getMessages(sessionId, {
            after,
            roles: CLIENT_ROLES,
        });
        if (session.status !== "closed") {
            await this.storage.updateSession(sessionId, { lastSeenAt: Date.now() });
        }
        return { status: session.status, messages };
    }
    /**
     * Email visitors who disconnected (no poll for >= thresholdMs) the agent/AI
     * replies they never saw. Idempotent via `notifiedAt`. Call from a cron.
     * Returns how many sessions were emailed.
     */
    async flushUnseen(thresholdMs) {
        if (!this.sendReplyNotification || thresholdMs <= 0)
            return 0;
        const now = Date.now();
        const idle = await this.storage.getSessionsIdleSince(now - thresholdMs);
        let sent = 0;
        for (const session of idle) {
            const since = Math.max(session.lastSeenAt ?? 0, session.notifiedAt ?? 0);
            const unseen = await this.storage.getMessages(session.id, {
                after: since,
                roles: ["ai", "agent"],
            });
            if (unseen.length === 0)
                continue;
            try {
                await this.sendReplyNotification(session, unseen);
                await this.storage.updateSession(session.id, { notifiedAt: now });
                sent++;
            }
            catch (err) {
                console.error("[chatkit] reply notification failed:", err);
            }
        }
        return sent;
    }
    /**
     * The visitor ended/reset the chat from their side. Post a notice into the
     * topic so agents know replies won't reach them, then close it. No transcript
     * email (the visitor chose to start over, not to wrap up).
     */
    async abandonSession(sessionId) {
        const session = await this.storage.getSession(sessionId);
        if (!session || session.status === "closed")
            return;
        await this.mirror(session, "🚪 <b>The visitor left / reset the chat.</b> Replies here won't reach them.");
        await this.storage.updateSession(sessionId, { status: "closed" });
        if (session.threadId != null) {
            await this.transport.closeTopic(session.threadId);
        }
    }
    async closeSession(sessionId) {
        const session = await this.storage.getSession(sessionId);
        if (!session)
            return;
        const alreadyClosed = session.status === "closed";
        if (!alreadyClosed) {
            await this.append(session, "system", "This chat has been closed. Thanks for getting in touch!");
        }
        await this.storage.updateSession(sessionId, { status: "closed" });
        // Email the transcript once, on the transition to closed.
        if (!alreadyClosed && this.sendTranscript) {
            try {
                const messages = await this.storage.getMessages(sessionId);
                await this.sendTranscript(session, messages);
            }
            catch (err) {
                console.error("[chatkit] transcript on close failed:", err);
            }
        }
        if (session.threadId != null) {
            await this.transport.closeTopic(session.threadId);
        }
    }
    // --- internals -----------------------------------------------------------
    async requireSession(id) {
        const s = await this.storage.getSession(id);
        if (!s)
            throw new ChatSessionNotFound(id);
        return s;
    }
    async append(session, role, text, authorName) {
        const message = {
            id: crypto.randomUUID(),
            sessionId: session.id,
            role,
            text,
            createdAt: Date.now(),
            ...(authorName ? { authorName } : {}),
        };
        await this.storage.appendMessage(message);
        return message;
    }
    async mirror(session, html) {
        if (session.threadId != null) {
            await this.transport.sendMessage(session.threadId, html);
        }
    }
}
export class ChatSessionNotFound extends Error {
    constructor(sessionId) {
        super(`chat session not found: ${sessionId}`);
        this.sessionId = sessionId;
        this.name = "ChatSessionNotFound";
    }
}
/** Escape text for Telegram HTML parse mode. */
function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
