import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher } from "@webpack/common";

const StreamStore = findByPropsLazy("getActiveStreamForUser", "getAllActiveStreams");
const UserStore = findByPropsLazy("getCurrentUser");
const RTCConnectionStore = findByPropsLazy("getMediaSessionId");

let styleElement: HTMLStyleElement | null = null;

const settings = definePluginSettings({
    hideHomeBadge: {
        type: OptionType.BOOLEAN,
        description: "Cacher le badge rouge de notification sur le bouton Accueil",
        default: true
    },
    hideDMBadges: {
        type: OptionType.BOOLEAN,
        description: "Cacher les badges et les points de non-lu sur les messages privés",
        default: true
    },
    debugMode: {
        type: OptionType.BOOLEAN,
        description: "Mode débogage - Affiche des logs détaillés dans la console",
        default: false
    }
});

function isStreaming(): boolean {
    try {
        const currentUser = UserStore?.getCurrentUser?.();
        if (!currentUser) return false;

        const userStream = StreamStore?.getActiveStreamForUser?.(currentUser.id);
        if (userStream) return true;

        const allStreams = StreamStore?.getAllActiveStreams?.();
        if (allStreams && allStreams.length > 0) {
            const myStream = allStreams.find((s: any) => s.ownerId === currentUser.id);
            if (myStream) return true;
        }

        const mediaSessionId = RTCConnectionStore?.getMediaSessionId?.();
        if (mediaSessionId) {
            const state = RTCConnectionStore?.getState?.();
            if (state && state.context === "stream") {
                return true;
            }
        }

        return false;
    } catch (e) {
        console.error("[NoDMWhileStreaming] Erreur lors de la vérification du stream:", e);
        return false;
    }
}

function injectHideCSS() {
    if (styleElement) return;

    styleElement = document.createElement("style");
    styleElement.id = "nodmwhilestreaming-hide-css";

    let cssRules = "";

    if (settings.store.hideHomeBadge) {
        cssRules += `
            /* Cache le badge sur l'icône Home */
            [data-list-item-id="guildsnav___home"] [class*="lowerBadge_"],
            [data-list-item-id="guildsnav___home"] [class*="numberBadge_"] {
                display: none !important;
            }
        `;
    }

    if (settings.store.hideDMBadges) {
        cssRules += `
            /* Cache les compteurs et points non lus dans la liste des DMs */
            [data-list-id="private-channels"] [class*="numberBadge_"],
            [data-list-id="private-channels"] [class*="unread_"] {
                display: none !important;
            }
        `;
    }

    styleElement.textContent = cssRules;
    document.head.appendChild(styleElement);
    if (settings.store.debugMode) {
        console.log("[NoDMWhileStreaming] CSS injecté pour cacher les DM.");
    }
}

function removeHideCSS() {
    if (styleElement) {
        styleElement.remove();
        styleElement = null;
        if (settings.store.debugMode) {
            console.log("[NoDMWhileStreaming] CSS retiré.");
        }
    }
}

function updateHideStatus() {
    const streaming = isStreaming();
    if (streaming) {
        injectHideCSS();
    } else {
        removeHideCSS();
    }
}

export default definePlugin({
    name: "NoDMWhileStreaming",
    description: "Retire l'affichage des notifications de DM dans la barre latérale lorsqu'un stream est lancé",
    authors: [Devs.Unknown],
    settings,

    start() {
        if (settings.store.debugMode) console.log("[NoDMWhileStreaming] Plugin démarré");
        updateHideStatus();

        FluxDispatcher.subscribe("STREAM_CREATE", updateHideStatus);
        FluxDispatcher.subscribe("STREAM_UPDATE", updateHideStatus);
        FluxDispatcher.subscribe("STREAM_DELETE", updateHideStatus);
        FluxDispatcher.subscribe("STREAM_START", updateHideStatus);
        FluxDispatcher.subscribe("STREAM_STOP", updateHideStatus);
        FluxDispatcher.subscribe("STREAM_CLOSE", updateHideStatus);
        FluxDispatcher.subscribe("RTC_CONNECTION_STATE", updateHideStatus);
        FluxDispatcher.subscribe("MEDIA_ENGINE_VIDEO_STATE_UPDATE", updateHideStatus);

        (this as any).checkInterval = setInterval(updateHideStatus, 2000);
    },

    stop() {
        if (settings.store.debugMode) console.log("[NoDMWhileStreaming] Plugin arrêté");

        FluxDispatcher.unsubscribe("STREAM_CREATE", updateHideStatus);
        FluxDispatcher.unsubscribe("STREAM_UPDATE", updateHideStatus);
        FluxDispatcher.unsubscribe("STREAM_DELETE", updateHideStatus);
        FluxDispatcher.unsubscribe("STREAM_START", updateHideStatus);
        FluxDispatcher.unsubscribe("STREAM_STOP", updateHideStatus);
        FluxDispatcher.unsubscribe("STREAM_CLOSE", updateHideStatus);
        FluxDispatcher.unsubscribe("RTC_CONNECTION_STATE", updateHideStatus);
        FluxDispatcher.unsubscribe("MEDIA_ENGINE_VIDEO_STATE_UPDATE", updateHideStatus);

        if ((this as any).checkInterval) {
            clearInterval((this as any).checkInterval);
            (this as any).checkInterval = null;
        }

        removeHideCSS();
    }
});
