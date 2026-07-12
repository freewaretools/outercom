/**
 * chatkit — portable customer-chat module.
 *
 * Core domain types. Nothing in this folder imports from the host app
 * (`@/...`); it depends only on npm packages + web/node built-ins, so the
 * whole `src/chatkit` directory can be lifted out into its own package.
 */
/** Who authored a message. */
export type ChatRole = "visitor" | "ai" | "agent" | "system";
/**
 * Lifecycle of a conversation.
 * - `ai`     — the AI first-line is handling the visitor.
 * - `live`   — a human agent has taken over (AI stays quiet).
 * - `closed` — the conversation has ended.
 */
export type ChatStatus = "ai" | "live" | "closed";
/** Details captured by the pre-chat form before messaging starts. */
export interface ChatVisitor {
    name: string;
    email: string;
    /** Optional "what do you need help with?" from the pre-chat form. */
    topic?: string;
}
export interface ChatMessage {
    id: string;
    sessionId: string;
    role: ChatRole;
    text: string;
    /** Display name of the author (for agent replies — the staff member's name). */
    authorName?: string;
    /** Epoch milliseconds. */
    createdAt: number;
}
export interface ChatSession {
    /** Opaque public id (uuid) — the client holds this to read/write its session. */
    id: string;
    visitor: ChatVisitor;
    /**
     * Transport thread id, once the thread/topic is created. Opaque string so any
     * backend fits (Telegram `message_thread_id`, Slack `thread_ts`, …).
     */
    threadId: string | null;
    status: ChatStatus;
    createdAt: number;
    updatedAt: number;
    /** Last time the visitor's widget polled/heartbeat — used to detect disconnect. */
    lastSeenAt?: number;
    /** Timestamp up to which unseen replies have been emailed (avoids re-sending). */
    notifiedAt?: number;
}
/** A human agent's reply parsed from an inbound transport webhook update. */
export interface ParsedAgentReply {
    threadId: string;
    text: string;
    /** Display name of the agent who replied, if available. */
    fromName?: string;
    /** True when the message is a control command (e.g. `/close`). */
    command?: "close";
}
/** Result of an AI first-line turn. */
export interface AIReply {
    /** The text to show the visitor. */
    text: string;
    /** True when the AI wants a human to take over. */
    escalate: boolean;
    /** Short internal note on why it escalated (shown to agents, not the visitor). */
    reason?: string;
}
/**
 * Optional first-line layer. Implement this to plug in a different LLM —
 * cloud ({@link AnthropicProvider}) or local/self-hosted ({@link LocalProvider}).
 */
export interface AIProvider {
    reply(history: ChatMessage[], visitor: ChatVisitor): Promise<AIReply>;
}
