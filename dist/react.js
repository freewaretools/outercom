"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * chatkit widget — a self-contained floating chat box.
 *
 * No CSS framework dependency: styling is inline + a small injected <style> for
 * the keyframes, themeable via the `accentColor` prop. Drop it into any React
 * app and point `apiBase` at the routes created with `chatkit/next`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
/**
 * The widget's notification sound: a soft two-tone "boop" on a running
 * AudioContext. Exported so a host can play the same sound for its own
 * prompts (e.g. a teaser card) instead of copying it. Browsers only start an
 * AudioContext after the visitor has interacted with the page, so check
 * `ctx.state === "running"` first.
 */
export function playBoop(ctx) {
    const now = ctx.currentTime;
    [660, 880].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const t = now + i * 0.11;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.12);
    });
}
/**
 * Whether the visitor muted notifications in the chat panel. Pass the same
 * `storageKey` the widget uses (default "chatkit:session").
 */
export function isChatMuted(storageKey = "chatkit:session") {
    try {
        return localStorage.getItem(`${storageKey}:muted`) === "1";
    }
    catch {
        return false;
    }
}
export function ChatWidget({ apiBase = "/api/chat", title: titleProp = "Chat with us", subtitle: subtitleProp = "We typically reply in a few minutes", greeting: greetingProp, accentColor: accentColorProp = "#0f172a", launcherLabel: launcherLabelProp = "Live Chat", launcherVariant = "accent", aiLabel: aiLabelProp = "Assistant", position: positionProp = "bottom-right", pollIntervalMs = 4000, storageKey = "chatkit:session", configUrl, visitor: visitorProp, hideLauncher = false, open: controlledOpen, onOpenChange, onUnreadChange, }) {
    // When configUrl is set, stay hidden until the runtime config says enabled.
    const [enabled, setEnabled] = useState(!configUrl);
    // Theming/config overrides fetched at runtime from configUrl (take precedence over props).
    const [overrides, setOverrides] = useState({});
    const [internalOpen, setInternalOpen] = useState(false);
    // Controlled when `open` prop is provided; otherwise self-managed.
    const open = controlledOpen ?? internalOpen;
    const setOpen = (v) => {
        const next = typeof v === "function" ? v(open) : v;
        onOpenChange?.(next);
        if (controlledOpen === undefined)
            setInternalOpen(next);
    };
    // Skip the pre-chat form when identity is already known.
    const [phase, setPhase] = useState(visitorProp ? "chat" : "form");
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [topic, setTopic] = useState("");
    const [sessionId, setSessionId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [status, setStatus] = useState("ai");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [muted, setMuted] = useState(false);
    const [unread, setUnread] = useState(false);
    const [emailState, setEmailState] = useState("idle");
    const afterRef = useRef(0);
    const seenIds = useRef(new Set());
    const scrollRef = useRef(null);
    const audioCtxRef = useRef(null);
    const armedRef = useRef(false); // suppress sound/unread on the first (history) sync
    const startingRef = useRef(false); // guard against double auto-start
    const openRef = useRef(open);
    const mutedRef = useRef(muted);
    const mutedKey = `${storageKey}:muted`;
    useEffect(() => {
        openRef.current = open;
    }, [open]);
    useEffect(() => {
        mutedRef.current = muted;
    }, [muted]);
    // Load mute preference + clear the unread dot when opened.
    useEffect(() => {
        try {
            setMuted(localStorage.getItem(mutedKey) === "1");
        }
        catch {
            /* ignore */
        }
    }, [mutedKey]);
    useEffect(() => {
        if (open)
            setUnread(false);
    }, [open]);
    // Surface unread changes to the host (e.g. to badge a menu item).
    useEffect(() => {
        onUnreadChange?.(unread);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [unread]);
    function toggleMute() {
        setMuted((m) => {
            const next = !m;
            try {
                localStorage.setItem(mutedKey, next ? "1" : "0");
            }
            catch {
                /* ignore */
            }
            return next;
        });
    }
    // Soft two-tone "boop" via Web Audio — no asset to bundle.
    function boop() {
        try {
            const Ctx = window.AudioContext ||
                window.webkitAudioContext;
            if (!Ctx)
                return;
            if (!audioCtxRef.current)
                audioCtxRef.current = new Ctx();
            const ctx = audioCtxRef.current;
            if (ctx.state === "suspended")
                void ctx.resume();
            playBoop(ctx);
        }
        catch {
            /* audio unavailable — ignore */
        }
    }
    // Resume a prior session from localStorage.
    useEffect(() => {
        try {
            const raw = localStorage.getItem(storageKey);
            if (raw) {
                const s = JSON.parse(raw);
                if (s?.sessionId) {
                    setSessionId(s.sessionId);
                    setName(s.visitor?.name ?? "");
                    setEmail(s.visitor?.email ?? "");
                    setPhase("chat");
                }
            }
        }
        catch {
            /* ignore */
        }
    }, [storageKey]);
    // Resolve enabled + theming at request time (avoids baking into a build).
    useEffect(() => {
        if (!configUrl)
            return;
        let cancelled = false;
        fetch(configUrl, { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .then((cfg) => {
            if (cancelled || !cfg)
                return;
            setEnabled(!!cfg.enabled);
            const next = {};
            if (cfg.greeting)
                next.greeting = cfg.greeting;
            if (cfg.accentColor)
                next.accentColor = cfg.accentColor;
            if (cfg.title)
                next.title = cfg.title;
            if (cfg.subtitle)
                next.subtitle = cfg.subtitle;
            if (cfg.launcherLabel)
                next.launcherLabel = cfg.launcherLabel;
            if (cfg.aiLabel)
                next.aiLabel = cfg.aiLabel;
            if (cfg.position === "bottom-left" || cfg.position === "bottom-right") {
                next.position = cfg.position;
            }
            setOverrides(next);
        })
            .catch(() => {
            /* leave hidden on error */
        });
        return () => {
            cancelled = true;
        };
    }, [configUrl]);
    const mergeMessages = useCallback((incoming, notify = false) => {
        const fresh = incoming.filter((m) => !seenIds.current.has(m.id));
        if (fresh.length === 0)
            return;
        let gotIncoming = false;
        for (const m of fresh) {
            seenIds.current.add(m.id);
            if (m.createdAt > afterRef.current)
                afterRef.current = m.createdAt;
            if (m.role === "ai" || m.role === "agent")
                gotIncoming = true;
        }
        setMessages((prev) => [...prev, ...fresh].sort((a, b) => a.createdAt - b.createdAt));
        if (notify && gotIncoming) {
            if (!mutedRef.current)
                boop();
            if (!openRef.current)
                setUnread(true);
        }
    }, []);
    const poll = useCallback(async () => {
        if (!sessionId)
            return;
        try {
            const res = await fetch(`${apiBase}/poll?sessionId=${encodeURIComponent(sessionId)}&after=${afterRef.current}`);
            if (!res.ok)
                return;
            const data = (await res.json());
            setStatus(data.status);
            // Don't sound/badge the first sync (it loads history); arm afterwards.
            mergeMessages(data.messages, armedRef.current);
            armedRef.current = true;
        }
        catch {
            /* transient network error — next tick retries */
        }
    }, [apiBase, sessionId, mergeMessages]);
    // Poll while a chat is active. Runs even when the bubble is closed (a slower
    // heartbeat) so the server knows the visitor is still present (last-seen) and
    // can show the unread dot / play a sound on incoming replies. When the tab is
    // truly gone, polling stops → the server can email unseen replies after X min.
    useEffect(() => {
        if (phase !== "chat" || !sessionId || status === "closed")
            return;
        poll();
        const interval = open ? pollIntervalMs : Math.max(pollIntervalMs * 6, 20000);
        const t = setInterval(poll, interval);
        return () => clearInterval(t);
    }, [open, phase, sessionId, status, pollIntervalMs, poll]);
    // Keep scrolled to the latest message.
    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }, [messages, open, phase]);
    async function doStart(v) {
        if (startingRef.current || sessionId)
            return;
        startingRef.current = true;
        setBusy(true);
        try {
            const res = await fetch(apiBase, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "start", visitor: v }),
            });
            const data = (await res.json());
            if (!res.ok || !data.sessionId) {
                setError(data.error ?? "Could not start the chat. Please try again.");
                return;
            }
            setSessionId(data.sessionId);
            setStatus("ai");
            try {
                localStorage.setItem(storageKey, JSON.stringify({ sessionId: data.sessionId, visitor: { name: v.name, email: v.email } }));
            }
            catch {
                /* ignore */
            }
            // Show the visitor's opening question locally; the AI reply arrives via poll.
            if (v.topic) {
                mergeMessages([localMessage(data.sessionId, "visitor", v.topic)]);
            }
            setPhase("chat");
        }
        catch {
            setError("Could not start the chat. Please try again.");
        }
        finally {
            setBusy(false);
            startingRef.current = false;
        }
    }
    async function startChat(e) {
        e.preventDefault();
        setError(null);
        if (!name.trim() || !isEmail(email)) {
            setError("Please enter your name and a valid email.");
            return;
        }
        await doStart({ name: name.trim(), email: email.trim(), topic: topic.trim() || undefined });
    }
    // Auto-start once the panel opens and identity is already known (logged-in).
    useEffect(() => {
        if (visitorProp && open && !sessionId && !startingRef.current) {
            void doStart({ name: visitorProp.name, email: visitorProp.email });
        }
        // doStart is stable enough for this guard-driven effect.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visitorProp, open, sessionId]);
    async function sendMessage(e) {
        e.preventDefault();
        const text = input.trim();
        if (!text || !sessionId || status === "closed")
            return;
        setInput("");
        mergeMessages([localMessage(sessionId, "visitor", text)]);
        setBusy(true);
        try {
            const res = await fetch(apiBase, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "send", sessionId, text }),
            });
            if (res.ok) {
                const data = (await res.json());
                setStatus(data.status);
                mergeMessages(data.messages, true);
            }
        }
        catch {
            /* poll will reconcile */
        }
        finally {
            setBusy(false);
        }
    }
    async function emailTranscript() {
        if (!sessionId || emailState === "sending")
            return;
        setEmailState("sending");
        try {
            const res = await fetch(apiBase, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "email", sessionId }),
            });
            const data = (await res.json().catch(() => ({})));
            setEmailState(res.ok && data.ok ? "sent" : "error");
        }
        catch {
            setEmailState("error");
        }
    }
    function resetChat() {
        // Tell the server the visitor ended this chat so agents in Telegram know
        // their replies won't land (and the topic gets closed). Fire-and-forget;
        // keepalive lets it finish even as we tear down local state.
        if (sessionId) {
            fetch(apiBase, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "end", sessionId }),
                keepalive: true,
            }).catch(() => { });
        }
        try {
            localStorage.removeItem(storageKey);
        }
        catch {
            /* ignore */
        }
        seenIds.current = new Set();
        afterRef.current = 0;
        armedRef.current = false;
        setMessages([]);
        setSessionId(null);
        setStatus("ai");
        setTopic("");
        setInput("");
        setEmailState("idle");
        setUnread(false);
        setPhase("form");
    }
    function handleReset() {
        // Confirm only if there's a conversation to lose.
        if (messages.length > 0 && !window.confirm("Start over? This clears the current conversation.")) {
            return;
        }
        resetChat();
    }
    // Gated off (or config not yet resolved) — render nothing.
    if (!enabled)
        return null;
    // Effective values: runtime config (overrides) wins over props.
    const accentColor = overrides.accentColor ?? accentColorProp;
    const title = overrides.title ?? titleProp;
    const subtitle = overrides.subtitle ?? subtitleProp;
    const resolvedGreeting = overrides.greeting ?? greetingProp;
    const launcherLabel = overrides.launcherLabel ?? launcherLabelProp;
    const aiLabel = overrides.aiLabel ?? aiLabelProp;
    const position = overrides.position ?? positionProp;
    const side = position === "bottom-left" ? { left: 20 } : { right: 20 };
    const headerSub = status === "live"
        ? "You're chatting with our team"
        : status === "closed"
            ? "This chat has ended"
            : subtitle;
    return (_jsxs("div", { style: { position: "fixed", bottom: 20, zIndex: 2147483000, ...side }, children: [_jsx("style", { children: KEYFRAMES }), open && (_jsxs("div", { style: { ...panelStyle(accentColor), bottom: hideLauncher ? 0 : 72 }, role: "dialog", "aria-label": title, children: [_jsxs("header", { style: headerStyle(accentColor), children: [_jsxs("div", { children: [_jsx("div", { style: { fontWeight: 600, fontSize: 15 }, children: title }), _jsx("div", { style: { fontSize: 12, opacity: 0.8 }, children: headerSub })] }), _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6, marginRight: -6 }, children: [phase === "chat" && (_jsxs(_Fragment, { children: [_jsx("button", { "aria-label": muted ? "Unmute notifications" : "Mute notifications", title: muted ? "Unmute" : "Mute", onClick: toggleMute, style: iconBtn, children: muted ? _jsx(MuteIcon, {}) : _jsx(SoundIcon, {}) }), _jsx("button", { "aria-label": "Start over", title: "Start over", onClick: handleReset, style: iconBtn, children: _jsx(RefreshIcon, {}) })] })), _jsx("button", { "aria-label": "Close chat", onClick: () => setOpen(false), style: iconBtn, children: _jsx(CloseIcon, {}) })] })] }), phase === "form" ? (_jsxs("form", { onSubmit: startChat, style: formStyle, children: [_jsx("p", { style: { margin: "0 0 4px", fontSize: 13, color: "#475569" }, children: "Tell us who you are and we'll get started." }), _jsx("input", { className: "ck-field", style: inputStyle, placeholder: "Your name", value: name, onChange: (e) => setName(e.target.value), autoComplete: "name", required: true }), _jsx("input", { className: "ck-field", style: inputStyle, type: "email", placeholder: "Your email", value: email, onChange: (e) => setEmail(e.target.value), autoComplete: "email", required: true }), _jsx("textarea", { className: "ck-field", style: { ...inputStyle, minHeight: 64, resize: "vertical" }, placeholder: "What can we help with? (optional)", value: topic, onChange: (e) => setTopic(e.target.value) }), error && _jsx("div", { style: errorStyle, children: error }), _jsx("button", { type: "submit", disabled: busy, style: primaryBtn(accentColor), children: busy ? "Starting…" : "Start chat" })] })) : (_jsxs(_Fragment, { children: [_jsxs("div", { ref: scrollRef, style: messagesStyle, children: [resolvedGreeting && messages.length === 0 && (_jsx(Bubble, { role: "ai", text: resolvedGreeting, aiLabel: aiLabel, accentColor: accentColor })), messages.map((m) => (_jsx(Bubble, { role: m.role, text: m.text, authorName: m.authorName, aiLabel: aiLabel, accentColor: accentColor }, m.id)))] }), status === "closed" ? (_jsxs("div", { style: {
                                    padding: 12,
                                    borderTop: "1px solid #e2e8f0",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 8,
                                }, children: [emailState === "sent" ? (_jsxs("span", { style: { textAlign: "center", fontSize: 13, color: "#16a34a" }, children: ["\u2713 Transcript sent to ", email] })) : (_jsx("button", { onClick: emailTranscript, disabled: emailState === "sending", style: secondaryBtn(accentColor), children: emailState === "sending" ? "Sending…" : "✉ Email me a copy" })), _jsx("button", { onClick: resetChat, style: primaryBtn(accentColor), children: "Start a new chat" })] })) : (_jsxs(_Fragment, { children: [messages.length > 0 && (_jsx("div", { style: transcriptRowStyle, children: emailState === "sent" ? (_jsxs("span", { style: { fontSize: 12.5, color: "#16a34a" }, children: ["\u2713 Transcript sent to ", email] })) : (_jsx("button", { type: "button", onClick: emailTranscript, disabled: emailState === "sending", style: linkBtn, children: emailState === "sending"
                                                ? "Sending…"
                                                : emailState === "error"
                                                    ? "Couldn't send — retry"
                                                    : "✉ Email me a copy" })) })), _jsxs("form", { onSubmit: sendMessage, style: composerStyle, children: [_jsx("input", { className: "ck-field", style: { ...inputStyle, margin: 0, flex: 1 }, placeholder: "Type a message\u2026", value: input, onChange: (e) => setInput(e.target.value), "aria-label": "Message" }), _jsx("button", { type: "submit", disabled: busy || !input.trim() || !sessionId, style: sendBtn(accentColor), children: "\u27A4" })] })] }))] }))] })), !hideLauncher && (_jsxs("button", { "aria-label": open ? "Close live chat" : "Open live chat", onClick: () => setOpen((v) => !v), style: launcherStyle(accentColor, launcherVariant), children: [open ? _jsx(CloseIcon, {}) : _jsx(ChatIcon, {}), _jsx("span", { children: open ? "Close" : launcherLabel }), unread && !open && _jsx("span", { style: unreadDotStyle })] }))] }));
}
function Bubble({ role, text, authorName, aiLabel, accentColor, }) {
    if (role === "system") {
        return (_jsx("div", { style: { textAlign: "center", fontSize: 12, color: "#64748b", margin: "6px 0" }, children: text }));
    }
    const mine = role === "visitor";
    const label = role === "agent"
        ? authorName || "Support"
        : role === "ai"
            ? aiLabel
            : "";
    return (_jsx("div", { style: { display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }, children: _jsxs("div", { style: { maxWidth: "80%" }, children: [label && (_jsx("div", { style: { fontSize: 11, color: "#94a3b8", margin: "0 4px 2px" }, children: label })), _jsx("div", { style: bubbleStyle(mine, accentColor), children: text })] }) }));
}
// --- helpers -----------------------------------------------------------------
let localCounter = 0;
function localMessage(sessionId, role, text) {
    return {
        id: `local-${++localCounter}`,
        sessionId,
        role,
        text,
        createdAt: Date.now(),
    };
}
function isEmail(s) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
}
// --- styles ------------------------------------------------------------------
const KEYFRAMES = `
@keyframes chatkit-pop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
.ck-field{color:#0f172a !important;-webkit-text-fill-color:#0f172a !important;background:#fff !important;font-size:14px;}
.ck-field::placeholder{color:#94a3b8 !important;opacity:1 !important;-webkit-text-fill-color:#94a3b8 !important;}
`;
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
function launcherStyle(accent, variant) {
    const light = variant === "light";
    return {
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: light ? "11px 18px" : "13px 20px",
        // "light" — white pill, black rim + text — for visibility on busy/dark pages.
        border: light ? "2px solid #000" : "none",
        borderRadius: 999,
        background: light ? "#fff" : accent,
        color: light ? "#000" : "#fff",
        fontSize: 15,
        fontWeight: 600,
        fontFamily: FONT,
        lineHeight: 1,
        cursor: "pointer",
        boxShadow: "0 6px 24px rgba(0,0,0,0.25)",
    };
}
const unreadDotStyle = {
    position: "absolute",
    top: -3,
    right: -3,
    width: 12,
    height: 12,
    borderRadius: "50%",
    background: "#ef4444",
    border: "2px solid #fff",
};
const transcriptRowStyle = {
    padding: "6px 12px",
    borderTop: "1px solid #e2e8f0",
    background: "#fff",
    textAlign: "center",
};
const linkBtn = {
    background: "transparent",
    border: "none",
    color: "#64748b",
    fontSize: 12.5,
    fontFamily: FONT,
    textDecoration: "underline",
    cursor: "pointer",
    padding: 0,
};
function secondaryBtn(accent) {
    return {
        width: "100%",
        padding: "10px 14px",
        background: "#fff",
        color: accent,
        border: `1px solid ${accent}`,
        borderRadius: 10,
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
    };
}
function ChatIcon() {
    return (_jsx("svg", { width: "20", height: "20", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: _jsx("path", { d: "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" }) }));
}
function CloseIcon() {
    return (_jsxs("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [_jsx("line", { x1: "18", y1: "6", x2: "6", y2: "18" }), _jsx("line", { x1: "6", y1: "6", x2: "18", y2: "18" })] }));
}
function HeaderSvg({ children }) {
    return (_jsx("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: children }));
}
function SoundIcon() {
    return (_jsxs(HeaderSvg, { children: [_jsx("path", { d: "M11 5 6 9H2v6h4l5 4z" }), _jsx("path", { d: "M15.5 8.5a5 5 0 0 1 0 7" }), _jsx("path", { d: "M19 5a9 9 0 0 1 0 14" })] }));
}
function MuteIcon() {
    return (_jsxs(HeaderSvg, { children: [_jsx("path", { d: "M11 5 6 9H2v6h4l5 4z" }), _jsx("line", { x1: "23", y1: "9", x2: "17", y2: "15" }), _jsx("line", { x1: "17", y1: "9", x2: "23", y2: "15" })] }));
}
function RefreshIcon() {
    return (_jsxs(HeaderSvg, { children: [_jsx("polyline", { points: "1 4 1 10 7 10" }), _jsx("path", { d: "M3.51 15a9 9 0 1 0 2.13-9.36L1 10" })] }));
}
function panelStyle(_accent) {
    return {
        position: "absolute",
        bottom: 72,
        right: 0,
        width: 360,
        maxWidth: "calc(100vw - 40px)",
        height: 520,
        maxHeight: "calc(100vh - 120px)",
        background: "#fff",
        borderRadius: 16,
        boxShadow: "0 12px 48px rgba(0,0,0,0.28)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: FONT,
        animation: "chatkit-pop .18s ease-out",
    };
}
function headerStyle(accent) {
    return {
        background: accent,
        color: "#fff",
        padding: "14px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
    };
}
const iconBtn = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 36,
    height: 36,
    flex: "0 0 auto",
    background: "transparent",
    border: "none",
    borderRadius: 8,
    color: "#fff",
    cursor: "pointer",
    opacity: 0.85,
    padding: 0,
};
const formStyle = {
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 10,
};
const messagesStyle = {
    flex: 1,
    overflowY: "auto",
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    background: "#f8fafc",
};
const composerStyle = {
    display: "flex",
    gap: 8,
    padding: 12,
    borderTop: "1px solid #e2e8f0",
    background: "#fff",
};
const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    fontSize: 14,
    fontFamily: FONT,
    boxSizing: "border-box",
    outline: "none",
};
function bubbleStyle(mine, accent) {
    return {
        padding: "9px 12px",
        borderRadius: 14,
        fontSize: 14,
        lineHeight: 1.4,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        background: mine ? accent : "#fff",
        color: mine ? "#fff" : "#0f172a",
        border: mine ? "none" : "1px solid #e2e8f0",
        borderBottomRightRadius: mine ? 4 : 14,
        borderBottomLeftRadius: mine ? 14 : 4,
    };
}
function primaryBtn(accent) {
    return {
        width: "100%",
        padding: "11px 14px",
        background: accent,
        color: "#fff",
        border: "none",
        borderRadius: 10,
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
    };
}
function sendBtn(accent) {
    return {
        flex: "0 0 auto",
        width: 42,
        background: accent,
        color: "#fff",
        border: "none",
        borderRadius: 10,
        fontSize: 16,
        cursor: "pointer",
    };
}
const errorStyle = {
    color: "#dc2626",
    fontSize: 12.5,
    margin: "-2px 0 2px",
};
