/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByProps } from "@webpack";
import { Forms, React, RTCConnectionStore, UserStore, useState } from "@webpack/common";

/**
 * GhostMic — affiche l'arceau vert "en train de parler" pour TOUS les
 * participants du salon vocal, sans activer le microphone réel.
 *
 * Mécanisme :
 *  1. RTCConnectionStore.getRTCConnection() expose la connexion WebRTC native.
 *     Cette connexion possède setSpeaking(flags) / setLocalSpeaking(flags) qui
 *     envoie directement l'opcode 5 (Speaking) sur le WebSocket vocal Discord
 *     => tous les autres membres du salon reçoivent l'événement SPEAKING.
 *  2. Fallback : MediaEngineStore.setSpeakingFlags pour l'affichage local.
 *  3. setForceAudioInput isSpeaking=true comme second fallback.
 */

let ghostMicEnabled = false;
let speakingInterval: ReturnType<typeof setInterval> | null = null;

// ─── core helpers ─────────────────────────────────────────────────────────────

/** Essaie d'émettre l'opcode Speaking=1 sur la connexion vocale active. */
function broadcastSpeaking(speaking: boolean) {
    const flags = speaking ? 1 : 0;

    // --- Méthode 1 : connexion RTC native (opcode 5, visible pour tous) ---
    try {
        const conn = RTCConnectionStore?.getRTCConnection?.();
        if (conn) {
            // Les versions de Discord peuvent exposer l'une ou l'autre
            conn.setSpeaking?.(flags);
            conn.setLocalSpeaking?.(flags);
            conn.speaking?.(flags);
        }
    } catch { /* pas de connexion active */ }

    // --- Méthode 2 : MediaEngineStore local (affichage client) ---
    try {
        const MediaEngine = findByProps("setSpeakingFlags");
        const me = UserStore.getCurrentUser();
        if (MediaEngine && me) MediaEngine.setSpeakingFlags(me.id, flags);
    } catch { /* ignore */ }

    // --- Méthode 3 : forceAudioInput isSpeaking (fallback) ---
    if (speaking) {
        try {
            const MediaEngine = findByProps("setForceAudioInput");
            MediaEngine?.setForceAudioInput?.(true, false, true);
        } catch { /* ignore */ }
    } else {
        try {
            const MediaEngine = findByProps("setForceAudioInput");
            MediaEngine?.setForceAudioInput?.(false, false, false);
        } catch { /* ignore */ }
    }
}

function startFakeSpeaking() {
    broadcastSpeaking(true);
    speakingInterval = setInterval(() => broadcastSpeaking(true), 80);
}

function stopFakeSpeaking() {
    if (speakingInterval !== null) {
        clearInterval(speakingInterval);
        speakingInterval = null;
    }
    broadcastSpeaking(false);
}

// ─── keybind listener ─────────────────────────────────────────────────────────

function handleKeyPress(e: KeyboardEvent) {
    const keybind = settings.store.keybind || "Ctrl+Shift+G";
    const keys = keybind.split("+");

    const needsCtrl = keys.includes("Ctrl");
    const needsShift = keys.includes("Shift");
    const needsAlt = keys.includes("Alt");
    const mainKey = keys[keys.length - 1].toUpperCase();

    if (
        e.ctrlKey === needsCtrl &&
        e.shiftKey === needsShift &&
        e.altKey === needsAlt &&
        e.key.toUpperCase() === mainKey
    ) {
        e.preventDefault();
        e.stopPropagation();
        ghostMicEnabled = !ghostMicEnabled;

        if (ghostMicEnabled) {
            startFakeSpeaking();
        } else {
            stopFakeSpeaking();
        }
    }
}

// ─── settings component ──────────────────────────────────────────────────────

function KeybindRecorder() {
    const [isRecording, setIsRecording] = useState(false);
    const [keybind, setKeybind] = useState(settings.store.keybind || "Ctrl+Shift+G");

    React.useEffect(() => {
        if (!isRecording) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();

            if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

            const keys: string[] = [];
            if (e.ctrlKey) keys.push("Ctrl");
            if (e.shiftKey) keys.push("Shift");
            if (e.altKey) keys.push("Alt");
            keys.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);

            const newKeybind = keys.join("+");
            setKeybind(newKeybind);
            settings.store.keybind = newKeybind;
            setIsRecording(false);
        };

        document.addEventListener("keydown", handleKeyDown, true);
        return () => document.removeEventListener("keydown", handleKeyDown, true);
    }, [isRecording]);

    const { FormSection, FormTitle, FormText } = Forms as any;
    return (
        <FormSection>
            <FormTitle tag="h3">Raccourci clavier (toggle)</FormTitle>
            <FormText>
                Cliquez sur "Enregistrer" puis appuyez sur la combinaison souhaitee.
                Par defaut : <strong>Ctrl+Shift+G</strong>
            </FormText>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px" }}>
                <input
                    type="text"
                    value={isRecording ? "Appuyez sur une touche…" : keybind}
                    readOnly
                    style={{
                        padding: "8px",
                        borderRadius: "4px",
                        border: "1px solid var(--background-modifier-accent)",
                        backgroundColor: isRecording
                            ? "var(--background-tertiary)"
                            : "var(--background-secondary)",
                        color: "var(--text-normal)",
                        flex: "1",
                        cursor: "default",
                    }}
                />
                <button
                    onClick={() => setIsRecording(!isRecording)}
                    style={{
                        padding: "8px 16px",
                        borderRadius: "4px",
                        border: "none",
                        backgroundColor: isRecording
                            ? "var(--button-danger-background)"
                            : "var(--button-secondary-background)",
                        color: "var(--white)",
                        cursor: "pointer",
                    }}
                >
                    {isRecording ? "Annuler" : "Enregistrer"}
                </button>
            </div>
        </FormSection>
    );
}

// ─── plugin definition ───────────────────────────────────────────────────────

const settings = definePluginSettings({
    keybind: {
        type: OptionType.STRING,
        description: "Raccourci clavier actuel",
        default: "Ctrl+Shift+G",
        hidden: true,
    },
});

export default definePlugin({
    name: "GhostMic",
    description:
        "Active l'illusion que ton micro est allumé (arceau vert dans les salons vocaux) sans pour autant activer le vrai microphone. Toggle via raccourci clavier.",
    authors: [{ name: "Baᛋh", id: 1462173272962764850n }],

    settings,
    settingsAboutComponent: () => <KeybindRecorder />,

    start() {
        document.addEventListener("keydown", handleKeyPress, true);
    },

    stop() {
        document.removeEventListener("keydown", handleKeyPress, true);

        // S'assurer que l'indicateur est bien éteint à la désactivation
        if (ghostMicEnabled) {
            ghostMicEnabled = false;
            stopFakeSpeaking();
        }
    },
});
