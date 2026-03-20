/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { ChannelStore, Menu, showToast, Toasts, UserStore } from "@webpack/common";

const VoiceStateStore = findStoreLazy("VoiceStateStore");
const ChannelActions = findByPropsLazy("selectVoiceChannel");

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

let disconnectTimeout: NodeJS.Timeout | null = null;
let scheduledAt = 0;
let scheduledForMs = 0;

function getPrivateVoiceChannelId(): string | null {
    const currentUser = UserStore.getCurrentUser();
    if (!currentUser) return null;

    const voiceState = VoiceStateStore.getVoiceStateForUser(currentUser.id);
    if (!voiceState?.channelId) return null;

    const channel = ChannelStore.getChannel(voiceState.channelId);
    if (!channel) return null;

    const isPrivateCall = channel.type === 1 || channel.type === 3;
    return isPrivateCall ? voiceState.channelId : null;
}

function clearSchedule(showFeedback = false) {
    if (disconnectTimeout) {
        clearTimeout(disconnectTimeout);
        disconnectTimeout = null;
    }

    scheduledAt = 0;
    scheduledForMs = 0;

    if (showFeedback) {
        showToast("Timer AntiSleepcall annule", Toasts.Type.MESSAGE);
    }
}

function scheduleDisconnect(delayMs: number, label: string) {
    if (delayMs <= 0) {
        showToast("Duree invalide", Toasts.Type.FAILURE);
        return;
    }

    const privateChannelId = getPrivateVoiceChannelId();
    if (!privateChannelId) {
        showToast("Tu dois etre dans un appel prive pour planifier la deco", Toasts.Type.FAILURE);
        return;
    }

    if (disconnectTimeout) {
        clearTimeout(disconnectTimeout);
    }

    scheduledAt = Date.now();
    scheduledForMs = delayMs;

    disconnectTimeout = setTimeout(() => {
        disconnectTimeout = null;

        const stillInPrivateCall = getPrivateVoiceChannelId();
        if (!stillInPrivateCall) {
            showToast("Timer termine, mais aucun appel prive actif", Toasts.Type.MESSAGE);
            scheduledAt = 0;
            scheduledForMs = 0;
            return;
        }

        try {
            ChannelActions.selectVoiceChannel(null);
            showToast("Deconnexion de l'appel prive effectuee", Toasts.Type.SUCCESS);
        } catch (error) {
            console.error("[AntiSleepcall] Erreur pendant la deconnexion:", error);
            showToast("Erreur pendant la deconnexion planifiee", Toasts.Type.FAILURE);
        } finally {
            scheduledAt = 0;
            scheduledForMs = 0;
        }
    }, delayMs);

    showToast(`Deconnexion planifiee dans ${label}`, Toasts.Type.SUCCESS);
}

function scheduleFromPrompt(unit: "minutes" | "heures") {
    const raw = window.prompt(
        unit === "minutes"
            ? "Entrez la duree en minutes"
            : "Entrez la duree en heures"
    );

    if (!raw) return;

    const value = Number(raw.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
        showToast("Valeur invalide", Toasts.Type.FAILURE);
        return;
    }

    if (unit === "minutes") {
        scheduleDisconnect(Math.round(value * MINUTE_MS), `${value} minute(s)`);
    } else {
        scheduleDisconnect(Math.round(value * HOUR_MS), `${value} heure(s)`);
    }
}

function getRemainingSeconds(): number {
    if (!disconnectTimeout || !scheduledAt || !scheduledForMs) return 0;

    const remainingMs = Math.max(0, scheduledAt + scheduledForMs - Date.now());
    return Math.ceil(remainingMs / 1000);
}

const UserContextMenuPatch: NavContextMenuPatchCallback = (children: any[], { user }: { user: any; }) => {
    if (!user) return;

    const group = findGroupChildrenByChildId("close-dm", children) ?? findGroupChildrenByChildId("call", children) ?? children;

    const remainingSeconds = getRemainingSeconds();

    group.push(
        <Menu.MenuSeparator key="anti-sleepcall-separator" />,
        <Menu.MenuItem
            id="anti-sleepcall-10m"
            label="AntiSleepcall: Deconnexion dans 10 min"
            action={() => scheduleDisconnect(10 * MINUTE_MS, "10 minutes")}
        />,
        <Menu.MenuItem
            id="anti-sleepcall-30m"
            label="AntiSleepcall: Deconnexion dans 30 min"
            action={() => scheduleDisconnect(30 * MINUTE_MS, "30 minutes")}
        />,
        <Menu.MenuItem
            id="anti-sleepcall-1h"
            label="AntiSleepcall: Deconnexion dans 1 h"
            action={() => scheduleDisconnect(1 * HOUR_MS, "1 heure")}
        />,
        <Menu.MenuItem
            id="anti-sleepcall-2h"
            label="AntiSleepcall: Deconnexion dans 2 h"
            action={() => scheduleDisconnect(2 * HOUR_MS, "2 heures")}
        />,
        <Menu.MenuItem
            id="anti-sleepcall-custom-min"
            label="AntiSleepcall: Duree perso (minutes)"
            action={() => scheduleFromPrompt("minutes")}
        />,
        <Menu.MenuItem
            id="anti-sleepcall-custom-hour"
            label="AntiSleepcall: Duree perso (heures)"
            action={() => scheduleFromPrompt("heures")}
        />,
        <Menu.MenuItem
            id="anti-sleepcall-cancel"
            label={remainingSeconds > 0
                ? `AntiSleepcall: Annuler le timer (${remainingSeconds}s restantes)`
                : "AntiSleepcall: Annuler le timer"}
            action={() => clearSchedule(true)}
            disabled={!disconnectTimeout}
        />
    );
};

export default definePlugin({
    name: "AntiSleepcall",
    description: "Planifie une deconnexion d'un appel prive depuis le menu contextuel utilisateur",
    authors: [{
        name: "Bash",
        id: 1327483363518582784n
    }],

    contextMenus: {
        "user-context": UserContextMenuPatch
    },

    stop() {
        clearSchedule();
    }
});
