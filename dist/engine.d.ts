import type { ChatStorage } from "./storage";
import type { ChatTransport } from "./transport";
import type { AIProvider, ChatMessage, ChatSession, ChatVisitor } from "./types";
export interface ChatEngineOptions {
    storage: ChatStorage;
    transport: ChatTransport;
    /** Optional first-line AI. Omit (or pass `aiEnabled: false`) for human-only chat. */
    ai?: AIProvider;
    aiEnabled?: boolean;
    /** Builds the forum-topic title for a new chat. Default: "Name · email". */
    topicName?: (visitor: ChatVisitor) => string;
    /** Message shown to the visitor when a chat is escalated to a human. */
    escalationMessage?: string;
    /**
     * Optional hook to email/send a transcript. Called when a chat is closed and
     * when the visitor requests a copy. Host-provided (e.g. render + Resend) so
     * chatkit stays mailer-agnostic.
     */
    sendTranscript?: (session: ChatSession, messages: ChatMessage[]) => Promise<void>;
    /**
     * Optional hook to email a visitor replies they haven't seen (because they
     * disconnected). Called by {@link flushUnseen}. Host-provided.
     */
    sendReplyNotification?: (session: ChatSession, unseen: ChatMessage[]) => Promise<void>;
}
/**
 * Orchestrates a conversation across the storage, Telegram transport, and the
 * optional AI first-line. Transport-agnostic at heart — `transport` is the only
 * Telegram-specific dependency and sits behind a small surface.
 */
export declare class ChatEngine {
    private readonly storage;
    private readonly transport;
    private readonly ai?;
    private readonly aiEnabled;
    private readonly topicName;
    private readonly escalationMessage;
    private readonly sendTranscript?;
    private readonly sendReplyNotification?;
    constructor(opts: ChatEngineOptions);
    /** Email the visitor a transcript on demand. Returns false if no mailer is wired. */
    emailTranscript(sessionId: string): Promise<boolean>;
    /**
     * Start a new chat: create the session, open a Telegram topic, and post the
     * captured visitor details. The pre-chat form has already collected name +
     * email (+ optional question) so a topic-per-chat is created up front.
     */
    startSession(visitor: ChatVisitor): Promise<{
        sessionId: string;
    }>;
    /**
     * Handle a visitor message: persist + mirror to Telegram, then (if the AI is
     * handling) generate a reply. Returns any new client-facing messages produced
     * synchronously (the AI reply / escalation note) so the widget can render
     * them immediately; async agent replies arrive via {@link poll}.
     */
    handleVisitorMessage(sessionId: string, text: string): Promise<{
        session: ChatSession;
        newMessages: ChatMessage[];
    }>;
    /**
     * Handle an inbound Telegram webhook update — a human agent replying in a
     * topic. Flips the session to `live` so the AI stays quiet, or closes it on
     * `/close`. Returns true if the update mapped to a known session.
     */
    handleWebhookUpdate(update: unknown): Promise<boolean>;
    /**
     * Poll for messages the visitor hasn't seen yet, plus the live status. Also
     * records the visitor as "seen" now (a present visitor is polling/heartbeating)
     * — the disconnect detector keys off this.
     */
    poll(sessionId: string, after?: number): Promise<{
        status: ChatSession["status"];
        messages: ChatMessage[];
    }>;
    /**
     * Email visitors who disconnected (no poll for >= thresholdMs) the agent/AI
     * replies they never saw. Idempotent via `notifiedAt`. Call from a cron.
     * Returns how many sessions were emailed.
     */
    flushUnseen(thresholdMs: number): Promise<number>;
    /**
     * The visitor ended/reset the chat from their side. Post a notice into the
     * topic so agents know replies won't reach them, then close it. No transcript
     * email (the visitor chose to start over, not to wrap up).
     */
    abandonSession(sessionId: string): Promise<void>;
    closeSession(sessionId: string): Promise<void>;
    private requireSession;
    private append;
    private mirror;
}
export declare class ChatSessionNotFound extends Error {
    readonly sessionId: string;
    constructor(sessionId: string);
}
