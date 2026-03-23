/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { React } from "@webpack/common";

import { settings } from "./settings";
import { DiffPanel } from "./ui/DiffPanel";
import { startFriendsCategoryInjection, stopFriendsCategoryInjection } from "./ui/FriendsCategory";
import { startWatcher, stopWatcher } from "./watcher";

export default definePlugin({
    name: "FriendSync",
    description: "Synchronise visuellement la liste d'amis entre plusieurs comptes Discord.",
    authors: [{
        name: "Bash",
        id: 1327483363518582784n
    }],
    settings,
    settingsAboutComponent: () => React.createElement(DiffPanel),
    start() {
        try {
            startWatcher();
            startFriendsCategoryInjection();
        } catch (error) {
            console.error("[FriendSync] Erreur au demarrage du plugin:", error);
        }
    },
    stop() {
        try {
            stopFriendsCategoryInjection();
            stopWatcher();
        } catch (error) {
            console.error("[FriendSync] Erreur a l'arret du plugin:", error);
        }
    }
});
