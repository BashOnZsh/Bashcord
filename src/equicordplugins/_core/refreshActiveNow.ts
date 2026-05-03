/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { FluxDispatcher } from "@webpack/common";

function refreshActiveNowPanel() {
    try {
        const panel = document.querySelector('[class*="nowPlayingColumn"]');
        if (!panel) {
            console.log("[RefreshActiveNow] Panel not found, skipping refresh");
            return;
        }

        const fiberKey = Object.keys(panel).find(k => k.startsWith("__reactFiber$"));
        if (!fiberKey) {
            console.log("[RefreshActiveNow] React fiber not found on panel");
            return;
        }

        let fiber = (panel as any)[fiberKey];
        while (fiber) {
            if (fiber.stateNode?.forceUpdate) {
                fiber.stateNode.forceUpdate();
                console.log("[RefreshActiveNow] Force updated Active Now panel");
                return;
            }
            fiber = fiber.return;
        }

        console.log("[RefreshActiveNow] No class component found in fiber tree");
    } catch (e) {
        console.error("[RefreshActiveNow] Error:", e);
    }
}

function onChannelSelect() {
    // Small delay to let the DOM settle after navigation
    setTimeout(refreshActiveNowPanel, 200);
}

export default definePlugin({
    name: "RefreshActiveNow",
    description: "Automatically refreshes the Active Now voice users panel on every channel change or Home button press.",
    authors: [EquicordDevs.omaw],
    required: true,

    start() {
        console.log("[RefreshActiveNow] Plugin started");
        FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelSelect);
    },

    stop() {
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelSelect);
    }
});
