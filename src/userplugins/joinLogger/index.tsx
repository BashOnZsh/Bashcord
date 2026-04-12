// @ts-nocheck

import definePlugin from "@utils/types";
import { SelectedChannelStore, UserStore } from "@webpack/common";

import { clearVoiceLogs } from "./state";
import { buildUI, injectToolbarButton, isLogsModalOpen, refreshUI, removeToolbarButton } from "./ui";
import { handleVoiceStateUpdates } from "./voice";

export default definePlugin({
    name: "VCJoinLogger",
    description: "Logs users who join or leave your current voice channel.",
    authors: [{ name: "SAMURAI", id: 1400403728552431698n }],
    requiresRestart: true,

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }) {
            const currentChannelId = SelectedChannelStore.getVoiceChannelId();
            if (!currentChannelId) return;

            handleVoiceStateUpdates(
                voiceStates,
                currentChannelId,
                UserStore.getCurrentUser().id,
                () => {
                    if (isLogsModalOpen()) {
                        refreshUI();
                    }
                }
            );
        }
    },

    start() {
        this.observer = new MutationObserver(() => {
            if (!document.getElementById("vc-logger-btn")) {
                injectToolbarButton(() => buildUI());
            }
        });

        this.observer.observe(document.body, { childList: true, subtree: true });

        injectToolbarButton(() => buildUI());
    },

    stop() {
        this.observer?.disconnect();
        removeToolbarButton();
        clearVoiceLogs();
    }
});
