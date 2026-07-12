import type { ChatTransport } from "./transport";
import type { ParsedAgentReply } from "./types";
export interface TelegramConfig {
    /** Bot token from @BotFather (use a DEDICATED bot for chat, not your ops bot). */
    botToken: string;
    /**
     * Chat id of the support group. Must be a *forum* supergroup (Topics enabled)
     * and the bot must be an admin with "Manage Topics" permission, otherwise
     * `createForumTopic` fails.
     */
    chatId: string | number;
}
/**
 * Telegram transport. v1 of chatkit's "human handoff" surface — designed
 * behind a thin interface so other transports (Slack, Discord, email) can be
 * added later without touching the engine.
 *
 * Each chat session gets its own forum topic; the agent replies inside that
 * topic and the webhook maps `message_thread_id` back to the session.
 */
export declare class TelegramTransport implements ChatTransport {
    private readonly cfg;
    constructor(cfg: TelegramConfig);
    private call;
    /** Create a forum topic and return its `message_thread_id` (as a string). */
    createTopic(name: string): Promise<string>;
    /** Post a message into a topic. Best-effort: never throws to the caller. */
    sendMessage(threadId: string, text: string): Promise<void>;
    /** Close a topic when a conversation ends (keeps the group tidy). */
    closeTopic(threadId: string): Promise<void>;
    /** Reopen a closed topic (so a returning visitor reuses the same thread). */
    reopenTopic(threadId: string): Promise<void>;
    /**
     * Parse an inbound webhook update into an agent reply, or `null` if it isn't
     * a relevant human message. Bots don't receive their own messages, so AI/bot
     * echoes never come back through here. Service messages (topic created, etc.)
     * and non-topic chatter are ignored.
     */
    parseUpdate(update: unknown): ParsedAgentReply | null;
}
