import type { ChatTransport, SendResult } from "./transport";
import type { ParsedAgentReply } from "./types";
/** A non-ok response from the Bot API, carrying Telegram's own `description`. */
export declare class TelegramApiError extends Error {
    readonly method: string;
    readonly description: string;
    readonly status: number;
    constructor(method: string, description: string, status: number);
}
/**
 * Does this error mean the topic itself is gone (someone deleted it)?
 *
 * Deliberately narrow. `TOPIC_NOT_MODIFIED` (already open), `chat not found`
 * (wrong group id) and auth errors all leave the topic intact — treating those
 * as "gone" would spawn a duplicate topic on every transient hiccup.
 */
export declare function isThreadGone(err: unknown): boolean;
export interface TelegramConfig {
    /** Bot token from @BotFather (use a DEDICATED bot for chat, not your ops bot). */
    botToken: string;
    /**
     * Chat id of the support group. Must be a *forum* supergroup (Topics enabled)
     * and the bot must be an admin with "Manage Topics" permission, otherwise
     * `createForumTopic` fails.
     */
    chatId: string | number;
    /**
     * How a finished chat is marked in the group.
     * - `"rename"` (default) — prefix the topic name with {@link closedPrefix}. The
     *   topic stays open, so agents who aren't group admins can still read and
     *   reply in it. Telegram makes a *closed* topic read-only for non-admins, which
     *   is the failure this mode exists to avoid.
     * - `"lock"` — the legacy behaviour: `closeForumTopic` / `reopenForumTopic`.
     */
    closeStyle?: "rename" | "lock";
    /** Prefix added to a finished chat's topic name in `"rename"` mode. Default `"✅ "`. */
    closedPrefix?: string;
    /** `fetch` override (tests, proxies). Defaults to the global. */
    fetch?: typeof fetch;
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
    sendMessage(threadId: string, text: string): Promise<SendResult>;
    /**
     * Mark a topic finished. In the default `"rename"` mode the topic is renamed
     * with a prefix and stays open (see {@link TelegramConfig.closeStyle}); Telegram
     * can't read a topic's name back, so `name` must be supplied — without it there
     * is nothing to rename and the call is a no-op.
     */
    closeTopic(threadId: string, name?: string): Promise<void>;
    /**
     * Reopen a finished topic (so a returning visitor reuses the same thread).
     * Returns false only if the topic has been deleted, so the caller knows to
     * create a new one instead of writing into a thread that no longer exists.
     *
     * In `"rename"` mode this also calls `reopenForumTopic` first: topics locked by
     * an older version (or by hand) are unlocked on the visitor's next return, so
     * switching modes needs no migration.
     */
    reopenTopic(threadId: string, name?: string): Promise<boolean>;
    private editName;
    /**
     * Parse an inbound webhook update into an agent reply, or `null` if it isn't
     * a relevant human message. Bots don't receive their own messages, so AI/bot
     * echoes never come back through here. Service messages (topic created, etc.)
     * and non-topic chatter are ignored.
     */
    parseUpdate(update: unknown): ParsedAgentReply | null;
}
