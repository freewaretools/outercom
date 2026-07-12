import type { ChatMessage, ChatSession, ChatRole } from "./types";
/**
 * Persistence seam. The host app supplies a concrete implementation
 * (e.g. Postgres/Prisma) so chatkit itself stays storage-agnostic.
 *
 * Sessions and the agent↔visitor relay are inherently async and survive
 * across requests/cold-starts, so a real adapter must be durable — the
 * in-memory adapter below is for local dev and the OSS demo only.
 */
export interface ChatStorage {
    createSession(session: ChatSession): Promise<void>;
    getSession(id: string): Promise<ChatSession | null>;
    /** Map an inbound transport thread back to its session. */
    getSessionByThread(threadId: string): Promise<ChatSession | null>;
    /**
     * Most recent thread id for a visitor email (case-insensitive), or null.
     * Lets the engine reuse one topic per customer instead of spawning a new one
     * each time they start a chat.
     */
    getThreadByEmail(email: string): Promise<string | null>;
    updateSession(id: string, patch: Partial<ChatSession>): Promise<void>;
    /**
     * Non-closed sessions whose visitor hasn't been seen since `beforeTs`
     * (using lastSeenAt, falling back to createdAt). Used to find disconnected
     * visitors who may have unseen replies to email.
     */
    getSessionsIdleSince(beforeTs: number): Promise<ChatSession[]>;
    appendMessage(message: ChatMessage): Promise<void>;
    getMessages(sessionId: string, opts?: {
        after?: number;
        roles?: ChatRole[];
    }): Promise<ChatMessage[]>;
}
/**
 * Reference adapter — keeps everything in process memory. Fine for `next dev`
 * on a single instance and for trying the OSS demo; do NOT use in production
 * (state is lost on restart and not shared across instances).
 */
export declare class InMemoryStorage implements ChatStorage {
    private sessions;
    private threadIndex;
    private messages;
    createSession(session: ChatSession): Promise<void>;
    getSession(id: string): Promise<ChatSession | null>;
    getSessionByThread(threadId: string): Promise<ChatSession | null>;
    getThreadByEmail(email: string): Promise<string | null>;
    updateSession(id: string, patch: Partial<ChatSession>): Promise<void>;
    getSessionsIdleSince(beforeTs: number): Promise<ChatSession[]>;
    appendMessage(message: ChatMessage): Promise<void>;
    getMessages(sessionId: string, opts?: {
        after?: number;
        roles?: ChatRole[];
    }): Promise<ChatMessage[]>;
}
