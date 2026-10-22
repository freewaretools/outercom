export interface ChatWidgetProps {
    /** Base path for the chat API routes. Default "/api/chat". */
    apiBase?: string;
    title?: string;
    subtitle?: string;
    /** Optional first assistant bubble shown before any reply arrives. */
    greeting?: string;
    accentColor?: string;
    /** Text on the launcher pill (default "Live Chat"). */
    launcherLabel?: string;
    /**
     * Launcher pill look: "accent" (filled with accentColor, default) or "light"
     * (white fill, black rim + text) for visibility on busy/dark pages.
     */
    launcherVariant?: "accent" | "light";
    /** Label shown on the AI's chat bubbles (default "Assistant"). Set to your brand. */
    aiLabel?: string;
    position?: "bottom-right" | "bottom-left";
    pollIntervalMs?: number;
    /** localStorage key for resuming a session across reloads. */
    storageKey?: string;
    /**
     * If set, the widget fetches `{ enabled, greeting }` from this URL on mount
     * and only renders when `enabled` is true. Lets the host gate + configure the
     * widget at request time, instead of baking on/off into a static build.
     */
    configUrl?: string;
    /**
     * Pre-known visitor (e.g. a logged-in user). When set, the pre-chat form is
     * skipped and a session auto-starts when the panel opens. For trust, also have
     * the server derive identity (see createChatRoutes `resolveVisitor`) — this
     * value is for display/convenience.
     */
    visitor?: {
        name: string;
        email: string;
    };
    /** Hide the floating launcher pill — host controls visibility via `open`. */
    hideLauncher?: boolean;
    /** Controlled open state. Provide with `onOpenChange` to drive from a menu, etc. */
    open?: boolean;
    /** Called when the widget requests open/close (e.g. its header close button). */
    onOpenChange?: (open: boolean) => void;
    /**
     * Called when the unread state changes (a reply arrived while the panel was
     * closed, or the panel opened and cleared it). Lets a host surface a badge
     * elsewhere — e.g. on a menu item — when the launcher is hidden.
     */
    onUnreadChange?: (unread: boolean) => void;
}
/**
 * The widget's notification sound: a soft two-tone "boop" on a running
 * AudioContext. Exported so a host can play the same sound for its own
 * prompts (e.g. a teaser card) instead of copying it. Browsers only start an
 * AudioContext after the visitor has interacted with the page, so check
 * `ctx.state === "running"` first.
 */
export declare function playBoop(ctx: AudioContext): void;
/**
 * Whether the visitor muted notifications in the chat panel. Pass the same
 * `storageKey` the widget uses (default "chatkit:session").
 */
export declare function isChatMuted(storageKey?: string): boolean;
export declare function ChatWidget({ apiBase, title: titleProp, subtitle: subtitleProp, greeting: greetingProp, accentColor: accentColorProp, launcherLabel: launcherLabelProp, launcherVariant, aiLabel: aiLabelProp, position: positionProp, pollIntervalMs, storageKey, configUrl, visitor: visitorProp, hideLauncher, open: controlledOpen, onOpenChange, onUnreadChange, }: ChatWidgetProps): import("react").JSX.Element | null;
