/**
 * Reference adapter — keeps everything in process memory. Fine for `next dev`
 * on a single instance and for trying the OSS demo; do NOT use in production
 * (state is lost on restart and not shared across instances).
 */
export class InMemoryStorage {
    constructor() {
        this.sessions = new Map();
        this.threadIndex = new Map();
        this.messages = new Map();
    }
    async createSession(session) {
        this.sessions.set(session.id, { ...session });
        if (session.threadId != null) {
            this.threadIndex.set(session.threadId, session.id);
        }
        if (!this.messages.has(session.id))
            this.messages.set(session.id, []);
    }
    async getSession(id) {
        const s = this.sessions.get(id);
        return s ? { ...s } : null;
    }
    async getSessionByThread(threadId) {
        const id = this.threadIndex.get(threadId);
        return id ? this.getSession(id) : null;
    }
    async getThreadByEmail(email) {
        const target = email.trim().toLowerCase();
        let latest = null;
        for (const s of this.sessions.values()) {
            if (s.threadId && s.visitor.email.trim().toLowerCase() === target) {
                if (!latest || s.createdAt > latest.createdAt)
                    latest = s;
            }
        }
        return latest?.threadId ?? null;
    }
    async getThreadSessions(threadId) {
        const out = [];
        for (const s of this.sessions.values()) {
            if (s.threadId === threadId)
                out.push({ ...s });
        }
        return out;
    }
    async updateSession(id, patch) {
        const existing = this.sessions.get(id);
        if (!existing)
            return;
        const next = { ...existing, ...patch, updatedAt: Date.now() };
        this.sessions.set(id, next);
        if (patch.threadId != null) {
            this.threadIndex.set(patch.threadId, id);
        }
    }
    async getSessionsIdleSince(beforeTs) {
        const out = [];
        for (const s of this.sessions.values()) {
            if (s.status === "closed")
                continue;
            if ((s.lastSeenAt ?? s.createdAt) < beforeTs)
                out.push({ ...s });
        }
        return out;
    }
    async appendMessage(message) {
        const list = this.messages.get(message.sessionId) ?? [];
        list.push({ ...message });
        this.messages.set(message.sessionId, list);
    }
    async getMessages(sessionId, opts) {
        let list = this.messages.get(sessionId) ?? [];
        if (opts?.after != null)
            list = list.filter((m) => m.createdAt > opts.after);
        if (opts?.roles)
            list = list.filter((m) => opts.roles.includes(m.role));
        return list.map((m) => ({ ...m }));
    }
}
