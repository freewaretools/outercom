import type { ChatMessage, ChatSession } from "./types";
export interface TranscriptOptions {
    /** Brand name used for the AI's label + email copy. */
    brand?: string;
}
export interface RenderedTranscript {
    subject: string;
    html: string;
    text: string;
}
/**
 * Render a chat session into an email-ready transcript (subject + HTML + plain
 * text). Pure and host-agnostic — the host wires it to its own mailer.
 */
export declare function renderTranscript(session: ChatSession, messages: ChatMessage[], opts?: TranscriptOptions): RenderedTranscript;
/**
 * Render a "you have new replies" email for a visitor who disconnected before
 * seeing the agent/AI reply(s). `replyUrl`, if given, links back to the chat.
 */
export declare function renderReplyNotification(session: ChatSession, unseen: ChatMessage[], opts?: TranscriptOptions & {
    replyUrl?: string;
}): RenderedTranscript;
