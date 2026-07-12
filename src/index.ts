/**
 * chatkit — a portable, self-hosted customer-chat module.
 *
 * A floating chat widget that routes conversations to wherever your team works
 * (Telegram in v1; the transport seam makes Slack/Discord/email pluggable),
 * with an optional Claude first-line that deflects common questions and
 * escalates to a human when needed.
 *
 * This is the framework-agnostic core. Entry points:
 *   - `chatkit`        → core (this file)
 *   - `chatkit/next`   → Next.js App Router route factories
 *   - `chatkit/react`  → the widget component
 *
 * The folder has no host-app imports, so it can be lifted into its own package.
 */

export * from "./types"
export * from "./storage"
export * from "./transport"
export * from "./telegram"
export * from "./ai"
export * from "./local"
export * from "./transcript"
export * from "./engine"
