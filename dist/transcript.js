/**
 * Render a chat session into an email-ready transcript (subject + HTML + plain
 * text). Pure and host-agnostic — the host wires it to its own mailer.
 */
export function renderTranscript(session, messages, opts = {}) {
    const brand = opts.brand ?? "Support";
    const subject = `Your chat with ${brand}`;
    const rows = messages
        .filter((m) => m.text && m.text.trim())
        .map((m) => ({
        role: m.role,
        who: m.role === "visitor"
            ? session.visitor.name
            : m.role === "agent"
                ? m.authorName || "Support"
                : m.role === "ai"
                    ? brand
                    : "",
        text: m.text,
    }));
    const htmlRows = rows
        .map((r) => r.role === "system"
        ? `<p style="margin:8px 0;color:#888;font-size:13px;font-style:italic">${esc(r.text)}</p>`
        : `<p style="margin:10px 0"><strong>${esc(r.who)}:</strong> ${esc(r.text)}</p>`)
        .join("");
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">` +
        `<h2 style="margin:0 0 4px">${esc(subject)}</h2>` +
        `<p style="color:#475569;margin:0 0 16px">Here's a copy of your conversation with ${esc(brand)}.</p>` +
        `<hr style="border:none;border-top:1px solid #e2e8f0"/>` +
        htmlRows +
        `<hr style="border:none;border-top:1px solid #e2e8f0"/>` +
        `<p style="color:#94a3b8;font-size:12px">Sent to ${esc(session.visitor.email)}.</p>` +
        `</div>`;
    const text = `${subject}\n\n` +
        rows.map((r) => (r.role === "system" ? `(${r.text})` : `${r.who}: ${r.text}`)).join("\n");
    return { subject, html, text };
}
/**
 * Render a "you have new replies" email for a visitor who disconnected before
 * seeing the agent/AI reply(s). `replyUrl`, if given, links back to the chat.
 */
export function renderReplyNotification(session, unseen, opts = {}) {
    const brand = opts.brand ?? "Support";
    const subject = `New reply from ${brand}`;
    const rows = unseen
        .filter((m) => m.text && m.text.trim())
        .map((m) => ({
        who: m.role === "agent" ? m.authorName || "Support" : brand,
        text: m.text,
    }));
    const htmlRows = rows
        .map((r) => `<p style="margin:10px 0"><strong>${esc(r.who)}:</strong> ${esc(r.text)}</p>`)
        .join("");
    const link = opts.replyUrl
        ? `<p style="margin:16px 0"><a href="${esc(opts.replyUrl)}" style="color:#0f172a">Reply to continue the conversation →</a></p>`
        : "";
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">` +
        `<h2 style="margin:0 0 4px">${esc(subject)}</h2>` +
        `<p style="color:#475569;margin:0 0 16px">Hi ${esc(session.visitor.name)}, you have a new reply to your chat:</p>` +
        `<hr style="border:none;border-top:1px solid #e2e8f0"/>` +
        htmlRows +
        link +
        `<hr style="border:none;border-top:1px solid #e2e8f0"/>` +
        `<p style="color:#94a3b8;font-size:12px">Sent to ${esc(session.visitor.email)} because you left the chat before this reply arrived.</p>` +
        `</div>`;
    const text = `${subject}\n\nHi ${session.visitor.name}, you have a new reply:\n\n` +
        rows.map((r) => `${r.who}: ${r.text}`).join("\n") +
        (opts.replyUrl ? `\n\nReply: ${opts.replyUrl}` : "");
    return { subject, html, text };
}
function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
