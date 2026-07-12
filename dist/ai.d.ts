import type { AIProvider, ChatMessage, ChatVisitor } from "./types";
export interface AnthropicProviderConfig {
    apiKey: string;
    /**
     * Model id. Defaults to Claude Haiku 4.5 — cheapest tier ($1/$5 per 1M
     * tokens), ample for grounded first-line support. Bump to
     * `claude-sonnet-4-6` if answers need more nuance.
     */
    model?: string;
    /** Product/FAQ content the AI must ground its answers in. */
    knowledgeBase: string;
    /** Company/brand name used in the persona. */
    brand?: string;
    /** Extra persona/policy text appended to the system prompt. */
    systemPromptExtra?: string;
    maxTokens?: number;
}
/**
 * Claude-backed first-line responder. Asks for a small JSON envelope and parses
 * it defensively (falls back to plain text). No `thinking` / `effort` — both
 * error on Haiku 4.5 and a support first-line doesn't need them.
 */
export declare class AnthropicProvider implements AIProvider {
    private readonly cfg;
    private clientPromise;
    private readonly model;
    private readonly maxTokens;
    constructor(cfg: AnthropicProviderConfig);
    private client;
    reply(history: ChatMessage[], visitor: ChatVisitor): Promise<import("./types").AIReply>;
}
