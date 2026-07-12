/**
 * Next.js App Router adapter. Wire these into `route.ts` files:
 *
 *   // src/app/api/chat/route.ts
 *   import { routes } from "@/lib/chat/config"
 *   export const runtime = "nodejs"
 *   export const POST = routes.chat.POST
 *
 * Uses only the Web `Request`/`Response` APIs, so it isn't tied to Next beyond
 * the file convention.
 */
import { ChatEngine } from "./engine";
type EngineResolver = () => ChatEngine | Promise<ChatEngine>;
export interface ChatRouteOptions {
    /** Shared secret to verify inbound transport webhooks. */
    webhookSecret?: string;
    /** Header that carries the secret. Defaults to Telegram's. */
    webhookSecretHeader?: string;
    /** Max length of a single visitor message. */
    maxMessageLength?: number;
    /**
     * Derive the visitor server-side (e.g. from the auth session). When set, the
     * `start` action uses this identity and IGNORES any client-sent name/email —
     * use it for authenticated apps so identity can't be spoofed. Return null to
     * reject the request (401). A client-sent `topic` is still honoured.
     */
    resolveVisitor?: (req: Request) => Promise<{
        name: string;
        email: string;
    } | null>;
}
export declare function createChatRoutes(getEngine: EngineResolver, options?: ChatRouteOptions): {
    /** POST /api/chat — { action: "start" | "send", ... } */
    chat: {
        POST: (req: Request) => Promise<Response>;
    };
    /** GET /api/chat/poll?sessionId=..&after=.. */
    poll: {
        GET: (req: Request) => Promise<Response>;
    };
    /** POST /api/chat/telegram — inbound transport webhook */
    webhook: {
        POST: (req: Request) => Promise<Response>;
    };
};
export {};
