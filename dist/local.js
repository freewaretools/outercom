import { buildSupportSystemPrompt, parseAIReply, toChatTurns } from "./prompt";
/**
 * Local / self-hosted first-line responder over the OpenAI-compatible Chat
 * Completions API. Same persona + JSON contract as {@link AnthropicProvider};
 * keeps all chat data on your own infrastructure with no per-token cost.
 *
 * Smaller local models can be shakier at strict JSON, but `parseAIReply` falls
 * back to treating the whole response as the reply, so a chat never breaks.
 */
export class LocalProvider {
    constructor(cfg) {
        this.cfg = cfg;
        this.endpoint = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    }
    async reply(history, visitor) {
        const turns = toChatTurns(history);
        if (turns.length === 0 || turns[0].role !== "user") {
            return { text: "Thanks for reaching out — how can I help?", escalate: false };
        }
        const res = await fetch(this.endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {}),
            },
            body: JSON.stringify({
                model: this.cfg.model,
                max_tokens: this.cfg.maxTokens ?? 1024,
                temperature: this.cfg.temperature ?? 0.2,
                stream: false,
                messages: [
                    { role: "system", content: buildSupportSystemPrompt(this.cfg, visitor) },
                    ...turns,
                ],
            }),
        });
        if (!res.ok) {
            throw new Error(`local LLM request failed: ${res.status} ${res.statusText}`);
        }
        const data = (await res.json());
        const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
        return parseAIReply(raw);
    }
}
