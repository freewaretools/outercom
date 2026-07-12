import { buildSupportSystemPrompt, parseAIReply, toChatTurns } from "./prompt";
const DEFAULT_MODEL = "claude-haiku-4-5";
/**
 * Claude-backed first-line responder. Asks for a small JSON envelope and parses
 * it defensively (falls back to plain text). No `thinking` / `effort` — both
 * error on Haiku 4.5 and a support first-line doesn't need them.
 */
export class AnthropicProvider {
    constructor(cfg) {
        this.cfg = cfg;
        this.clientPromise = null;
        this.model = cfg.model ?? DEFAULT_MODEL;
        this.maxTokens = cfg.maxTokens ?? 1024;
    }
    // Lazy-load the SDK so it's only required when Claude is actually used —
    // local-LLM / human-only consumers don't need @anthropic-ai/sdk installed.
    client() {
        if (!this.clientPromise) {
            this.clientPromise = import("@anthropic-ai/sdk").then((m) => new m.default({ apiKey: this.cfg.apiKey }));
        }
        return this.clientPromise;
    }
    async reply(history, visitor) {
        const turns = toChatTurns(history);
        if (turns.length === 0 || turns[0].role !== "user") {
            return { text: "Thanks for reaching out — how can I help?", escalate: false };
        }
        const client = await this.client();
        const res = await client.messages.create({
            model: this.model,
            max_tokens: this.maxTokens,
            system: buildSupportSystemPrompt(this.cfg, visitor),
            messages: turns,
        });
        const raw = res.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("")
            .trim();
        return parseAIReply(raw);
    }
}
