/**
 * Shared prompt + parsing logic for AI providers, so cloud (Anthropic) and
 * local (OpenAI-compatible) providers behave identically — same persona, same
 * grounding rules, same `{reply, escalate, reason}` contract.
 */
import type { AIReply, ChatMessage, ChatVisitor } from "./types";
export interface SupportPromptConfig {
    /** Product/FAQ content the AI must ground its answers in. */
    knowledgeBase: string;
    /** Company/brand name used in the persona. */
    brand?: string;
    /** Extra persona/policy text appended to the system prompt. */
    systemPromptExtra?: string;
}
/** A provider-neutral chat turn (matches both OpenAI and Anthropic message shapes). */
export interface ChatTurn {
    role: "user" | "assistant";
    content: string;
}
export declare function buildSupportSystemPrompt(cfg: SupportPromptConfig, visitor: ChatVisitor): string;
/** Map chat history to neutral turns (visitor → user, ai/agent → assistant; system dropped). */
export declare function toChatTurns(history: ChatMessage[]): ChatTurn[];
/** Defensively extract `{ reply, escalate, reason }` from raw model output. */
export declare function parseAIReply(raw: string): AIReply;
