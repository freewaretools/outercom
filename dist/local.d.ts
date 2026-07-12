import type { AIProvider, ChatMessage, ChatVisitor } from "./types";
export interface LocalProviderConfig {
    /**
     * OpenAI-compatible base URL (ending in `/v1`). Works with any server that
     * speaks the Chat Completions API:
     *   - Ollama       → http://localhost:11434/v1
     *   - LM Studio    → http://localhost:1234/v1
     *   - llama.cpp    → http://localhost:8080/v1
     *   - vLLM / TGI   → http://localhost:8000/v1
     * From inside a Docker container, point at the host (e.g.
     * http://host.docker.internal:11434/v1) or run the model in the same network.
     */
    baseUrl: string;
    /** Model name as the server knows it (e.g. "llama3.1:8b", "qwen2.5:7b-instruct"). */
    model: string;
    /** Optional bearer token (some servers require any non-empty value). */
    apiKey?: string;
    knowledgeBase: string;
    brand?: string;
    systemPromptExtra?: string;
    maxTokens?: number;
    /** Low by default for reliable JSON. */
    temperature?: number;
}
/**
 * Local / self-hosted first-line responder over the OpenAI-compatible Chat
 * Completions API. Same persona + JSON contract as {@link AnthropicProvider};
 * keeps all chat data on your own infrastructure with no per-token cost.
 *
 * Smaller local models can be shakier at strict JSON, but `parseAIReply` falls
 * back to treating the whole response as the reply, so a chat never breaks.
 */
export declare class LocalProvider implements AIProvider {
    private readonly cfg;
    private readonly endpoint;
    constructor(cfg: LocalProviderConfig);
    reply(history: ChatMessage[], visitor: ChatVisitor): Promise<import("./types").AIReply>;
}
