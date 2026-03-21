// @ts-nocheck
import definePlugin from "@utils/types";
import { showNotification } from "@api/Notifications";
import { UserStore, SelectedChannelStore, GuildMemberStore } from "@webpack/common";

const MAX_LOGS = 300;

let logs = [];

function copyToClipboard(text) {
    const nativeClipboard = globalThis?.DiscordNative?.clipboard;
    if (nativeClipboard?.copy) {
        nativeClipboard.copy(text);
        return Promise.resolve();
    }

    if (navigator?.clipboard?.writeText) {
        return navigator.clipboard.writeText(text);
    }

    return Promise.reject(new Error("Clipboard API unavailable"));
}

function getAvatarUrl(user, size) {
    if (!user?.getAvatarURL) {
        return "https://cdn.discordapp.com/embed/avatars/0.png";
    }
    return user.getAvatarURL(null, size) || "https://cdn.discordapp.com/embed/avatars/0.png";
}

function formatTimestamp() {
    return new Date().toLocaleString([], {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function buildUI() {
    const existing = document.getElementById("vc-logger-overlay");
    if (existing) {
        existing.remove();
        return;
    }

    const backdrop = document.createElement("div");
    backdrop.id = "vc-logger-overlay";
    Object.assign(backdrop.style, {
        position: "fixed", top: "0", left: "0", width: "100vw", height: "100vh",
        backgroundColor: "rgba(0, 0, 0, 0.7)", zIndex: "99999",
        display: "flex", justifyContent: "center", alignItems: "center",
        fontFamily: "var(--font-primary)"
    });
    backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };

    const container = document.createElement("div");
    Object.assign(container.style, {
        width: "500px", maxHeight: "80vh",
        backgroundColor: "var(--background-primary)",
        borderRadius: "8px", display: "flex", flexDirection: "column",
        boxShadow: "0 0 20px rgba(0,0,0,0.5)",
        border: "1px solid var(--background-modifier-accent)",
        overflow: "hidden"
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
        padding: "16px", display: "flex", alignItems: "center", gap: "10px",
        borderBottom: "1px solid var(--background-modifier-accent)",
        backgroundColor: "var(--background-secondary)"
    });

    const title = document.createElement("h2");
    title.innerText = `VC Logs (${logs.length})`;
    Object.assign(title.style, { flex: "1", margin: "0", fontSize: "20px", fontWeight: "bold", color: "white" });

    const createBtn = (html, titleText, color, onClick) => {
        const btn = document.createElement("div");
        btn.innerHTML = html;
        btn.title = titleText;
        btn.style.cursor = "pointer";
        btn.style.color = color;
        btn.style.display = "flex";
        btn.onclick = onClick;
        return btn;
    };

    const copyAllBtn = createBtn(
        '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" /></svg>',
        "Copy All", "white",
        async () => {
            if (logs.length === 0) {
                showNotification({
                    title: "Error",
                    body: "There's nothing to copy :)",
                    color: "#ed4245"
                });
                return;
            }

            const text = logs.map(l => `Display: ${l.displayName}\nUsername: ${l.username}\nID: ${l.userId}\nTime: ${l.time}\n------------------`).join("\n");
            try {
                await copyToClipboard(text);
                showNotification({ title: "Success", body: "Copied all logs!", color: "#43b581" });
            } catch {
                showNotification({ title: "Error", body: "Unable to copy logs", color: "#ed4245" });
            }
        }
    );

    const clearBtn = createBtn(
        '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M15 3.999V2H9v1.999H3V5.5h18V3.999h-6zM5 6.999v13C5 21.103 6.897 23 7.999 23h8c1.103 0 3-1.897 3-3.001v-13H5zm4.001 11H8.002v-7h.999v7zm3.001 0h-.999v-7h.999v7zm2.999 0h-1v-7h1v7z" /></svg>',
        "Clear Logs", "var(--status-danger)",
        () => {
            logs = [];
            backdrop.remove();
            buildUI();
        }
    );

    const closeBtn = createBtn(
        '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" /></svg>',
        "Close", "white",
        () => backdrop.remove()
    );

    header.append(title, copyAllBtn, clearBtn, closeBtn);

    const list = document.createElement("div");
    Object.assign(list.style, { flex: "1", overflowY: "auto", padding: "0" });

    if (logs.length === 0) {
        list.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--text-muted);">No logs yet. Waiting for users...</div>`;
    } else {
        logs.forEach(log => {
            const user = UserStore.getUser(log.userId);
            const avatarUrl = getAvatarUrl(user, 40);

            const row = document.createElement("div");
            Object.assign(row.style, {
                display: "flex", padding: "10px 16px", alignItems: "center", gap: "12px",
                borderBottom: "1px solid var(--background-modifier-accent)",
                backgroundColor: "var(--background-secondary-alt)",
                userSelect: "text"
            });

            const avatar = document.createElement("img");
            avatar.src = avatarUrl;
            Object.assign(avatar.style, {
                width: "36px",
                height: "36px",
                borderRadius: "50%",
                userSelect: "none"
            });

            const main = document.createElement("div");
            Object.assign(main.style, { flex: "1", overflow: "hidden" });

            const displayNameEl = document.createElement("div");
            displayNameEl.textContent = log.displayName;
            Object.assign(displayNameEl.style, { fontWeight: "600", color: "#FFFFFF", lineHeight: "1.2" });

            const usernameEl = document.createElement("div");
            usernameEl.textContent = `@${log.username}`;
            Object.assign(usernameEl.style, { fontSize: "12px", color: "#B9BBBE", lineHeight: "1.2" });

            const idLine = document.createElement("div");
            Object.assign(idLine.style, {
                fontSize: "11px",
                color: "var(--text-muted)",
                marginTop: "2px",
                display: "flex",
                alignItems: "center",
                fontFamily: "var(--font-code)"
            });

            const idText = document.createElement("span");
            idText.textContent = log.userId;
            idText.style.marginRight = "6px";

            const copyBtn = document.createElement("div");
            copyBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" /></svg>';
            copyBtn.title = "Copy ID";
            Object.assign(copyBtn.style, {
                cursor: "pointer",
                color: "var(--interactive-normal)",
                opacity: "0.7",
                display: "flex"
            });

            idLine.append(idText, copyBtn);
            main.append(displayNameEl, usernameEl, idLine);

            const timeEl = document.createElement("div");
            timeEl.textContent = log.time;
            Object.assign(timeEl.style, {
                fontSize: "11px",
                color: "var(--text-muted)",
                whiteSpace: "nowrap",
                userSelect: "none"
            });

            row.append(avatar, main, timeEl);

            if (copyBtn) {
                copyBtn.onclick = async (e) => {
                    e.stopPropagation();
                    try {
                        await copyToClipboard(log.userId);
                        showNotification({ title: "Copied", body: "User ID copied", color: "#43b581" });
                    } catch {
                        showNotification({ title: "Error", body: "Unable to copy user ID", color: "#ed4245" });
                    }
                };
            }
            list.appendChild(row);
        });
    }

    container.append(header, list);
    backdrop.appendChild(container);
    document.body.appendChild(backdrop);
}

function injectToolbarButton() {
    const inboxIcon = document.querySelector('[aria-label="Inbox"]');
    if (!inboxIcon) return;

    if (document.getElementById("vc-logger-btn")) return;

    const btn = document.createElement("div");
    btn.id = "vc-logger-btn";
    btn.className = inboxIcon.className;
    btn.setAttribute("role", "button");
    btn.setAttribute("aria-label", "VC Logger");
    btn.setAttribute("tabindex", "0");
    btn.style.cursor = "pointer";

    btn.innerHTML = `
        <svg aria-hidden="true" role="img" width="24" height="24" viewBox="0 0 24 24">
            <path fill="currentColor" fill-rule="evenodd" d="M3 4h18v2H3V4zm0 7h18v2H3v-2zm0 7h18v2H3v-2z"></path>
        </svg>
    `;

    btn.onclick = (e) => {
        e.stopPropagation();
        buildUI();
    };

    if (!inboxIcon.parentElement) return;
    inboxIcon.parentElement.insertBefore(btn, inboxIcon);
}

function addLog(userId, guildId) {
    const user = UserStore.getUser(userId);
    if (!user) return;

    const member = GuildMemberStore.getMember(guildId, userId);
    const displayName = member?.nick || user.globalName || user.username;

    logs.unshift({
        userId,
        username: user.username,
        displayName: displayName,
        time: formatTimestamp()
    });

    if (logs.length > MAX_LOGS) {
        logs.length = MAX_LOGS;
    }

    if (document.getElementById("vc-logger-overlay")) {
        buildUI();
    }

    showNotification({
        title: "User Logged",
        body: `${displayName} joined`,
        color: "#43b581",
        icon: getAvatarUrl(user, 64)
    });
}

export default definePlugin({
    name: "VCJoinLogger",
    description: "Logs users who join your current voice channel.",
    authors: [{ name: "SAMURAI", id: 1400403728552431698n }],

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }) {
            const myChannelId = SelectedChannelStore.getVoiceChannelId();
            if (!myChannelId) return;

            for (const { userId, channelId, oldChannelId, guildId } of voiceStates) {
                if (userId === UserStore.getCurrentUser().id) continue;
                if (channelId === myChannelId && oldChannelId !== myChannelId) {
                    addLog(userId, guildId);
                }
            }
        }
    },

    start() {
        this.observer = new MutationObserver(() => {
            if (!document.getElementById("vc-logger-btn")) {
                injectToolbarButton();
            }
        });

        this.observer.observe(document.body, { childList: true, subtree: true });

        injectToolbarButton();
    },

    stop() {
        this.observer?.disconnect();

        const btn = document.getElementById("vc-logger-btn");
        if (btn) btn.remove();

        const ui = document.getElementById("vc-logger-overlay");
        if (ui) ui.remove();

        logs = [];
    }
});
