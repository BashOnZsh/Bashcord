// @ts-nocheck

import { showNotification } from "@api/Notifications";
import { ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, ModalSize, closeModal, openModal } from "@utils/modal";
import { React, UserStore } from "@webpack/common";

import { buildCopyText, clearVoiceLogs, getEventColor, getEventLabel, getVoiceLogs, isVoiceLogEmpty } from "./state";

const JOIN_LOGGER_MODAL_KEY = "vc-join-logger-modal";
let modalOpen = false;

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

function getEventIcon(type) {
    return type === "leave" ? "-" : "+";
}

function closeLogsModal() {
    closeModal(JOIN_LOGGER_MODAL_KEY);
    modalOpen = false;
}

function LogsModal({ modalProps }: { modalProps: ModalProps; }) {
    const logs = getVoiceLogs();

    React.useEffect(() => {
        return () => {
            modalOpen = false;
        };
    }, []);

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE}>
            <ModalHeader>
                <h2 style={{ margin: 0, fontSize: "20px", fontWeight: "bold", color: "white" }}>VC Logs ({logs.length})</h2>
            </ModalHeader>

            <ModalContent>
                <div style={{ maxHeight: "65vh", overflowY: "auto" }}>
                    {logs.length === 0 && (
                        <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
                            No logs yet. Waiting for users...
                        </div>
                    )}

                    {logs.map(log => {
                        const user = UserStore.getUser(log.userId);
                        const avatarUrl = getAvatarUrl(user, 40);

                        return (
                            <div
                                key={`${log.userId}-${log.createdAt}-${log.type}`}
                                style={{
                                    display: "flex",
                                    padding: "10px 12px",
                                    alignItems: "center",
                                    gap: "12px",
                                    borderBottom: "1px solid var(--background-modifier-accent)",
                                    backgroundColor: "var(--background-secondary-alt)",
                                    userSelect: "text"
                                }}
                            >
                                <img src={avatarUrl} style={{ width: "36px", height: "36px", borderRadius: "50%", userSelect: "none" }} />

                                <div style={{ flex: "1", overflow: "hidden" }}>
                                    <div
                                        style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: "5px",
                                            padding: "3px 8px",
                                            borderRadius: "999px",
                                            fontSize: "11px",
                                            fontWeight: "700",
                                            width: "fit-content",
                                            marginBottom: "4px",
                                            color: getEventColor(log.type),
                                            backgroundColor: `${getEventColor(log.type)}22`
                                        }}
                                    >
                                        <span>{getEventIcon(log.type)}</span>
                                        <span>{getEventLabel(log.type)}</span>
                                    </div>

                                    <div style={{ fontWeight: "600", color: "#FFFFFF", lineHeight: "1.2" }}>{log.displayName}</div>
                                    <div style={{ fontSize: "12px", color: "#B9BBBE", lineHeight: "1.2" }}>@{log.username}</div>

                                    <div
                                        style={{
                                            fontSize: "11px",
                                            color: "var(--text-muted)",
                                            marginTop: "2px",
                                            display: "flex",
                                            alignItems: "center",
                                            fontFamily: "var(--font-code)",
                                            gap: "8px"
                                        }}
                                    >
                                        <span>{log.userId}</span>
                                        <button
                                            onClick={async e => {
                                                e.stopPropagation();
                                                try {
                                                    await copyToClipboard(log.userId);
                                                    showNotification({ title: "Copied", body: "User ID copied", color: "#43b581" });
                                                } catch {
                                                    showNotification({ title: "Error", body: "Unable to copy user ID", color: "#ed4245" });
                                                }
                                            }}
                                            style={{
                                                cursor: "pointer",
                                                border: "none",
                                                background: "transparent",
                                                color: "var(--interactive-normal)",
                                                fontSize: "11px",
                                                padding: 0
                                            }}
                                        >
                                            Copy ID
                                        </button>
                                    </div>
                                </div>

                                <div style={{ fontSize: "11px", color: "var(--text-muted)", whiteSpace: "nowrap", userSelect: "none" }}>{log.time}</div>
                            </div>
                        );
                    })}
                </div>
            </ModalContent>

            <ModalFooter>
                <button
                    onClick={async () => {
                        if (isVoiceLogEmpty()) {
                            showNotification({ title: "Error", body: "There's nothing to copy :)", color: "#ed4245" });
                            return;
                        }

                        try {
                            await copyToClipboard(buildCopyText(logs));
                            showNotification({ title: "Success", body: "Copied all logs!", color: "#43b581" });
                        } catch {
                            showNotification({ title: "Error", body: "Unable to copy logs", color: "#ed4245" });
                        }
                    }}
                    style={{ cursor: "pointer" }}
                >
                    Copy All
                </button>

                <button
                    onClick={() => {
                        clearVoiceLogs();
                        refreshUI();
                    }}
                    style={{ cursor: "pointer" }}
                >
                    Clear Logs
                </button>

                <button
                    onClick={() => {
                        modalProps.onClose();
                        modalOpen = false;
                    }}
                    style={{ cursor: "pointer" }}
                >
                    Close
                </button>
            </ModalFooter>
        </ModalRoot>
    );
}

export function buildUI() {
    if (modalOpen) {
        closeLogsModal();
        return;
    }

    modalOpen = true;
    openModal(modalProps => <LogsModal modalProps={modalProps} />, { modalKey: JOIN_LOGGER_MODAL_KEY });
}

export function refreshUI() {
    if (!modalOpen) return;
    closeLogsModal();
    buildUI();
}

export function isLogsModalOpen() {
    return modalOpen;
}

export function injectToolbarButton(onOpen) {
    const inboxIcon = document.querySelector('[aria-label="Inbox"]');
    if (!inboxIcon || document.getElementById("vc-logger-btn") || !inboxIcon.parentElement) return;

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

    btn.onclick = e => {
        e.stopPropagation();
        onOpen?.();
    };

    inboxIcon.parentElement.insertBefore(btn, inboxIcon);
}

export function removeToolbarButton() {
    closeLogsModal();
    document.getElementById("vc-logger-btn")?.remove();
}
