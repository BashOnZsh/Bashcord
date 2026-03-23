/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { RelationshipStore, UserStore } from "@webpack/common";

export interface FriendEntry {
    userId: string;
    username: string;
    globalName: string | null;
}

type RelationshipStoreLike = {
    getFriendIDs?: () => string[];
    getRelationships?: () => Record<string, number>;
};

function getFriendIds(): string[] {
    const store = RelationshipStore as RelationshipStoreLike;

    if (typeof store.getFriendIDs === "function") {
        const ids = store.getFriendIDs();
        if (Array.isArray(ids)) return ids;
    }

    if (typeof store.getRelationships === "function") {
        const relationships = store.getRelationships();
        return Object.entries(relationships)
            .filter(([, relation]) => relation === 1)
            .map(([userId]) => userId);
    }

    return [];
}

export function extractFriends(): FriendEntry[] {
    const ids = getFriendIds();

    return ids.map(userId => {
        const user = UserStore.getUser(userId);
        return {
            userId,
            username: user?.username ?? "Unknown",
            globalName: user?.globalName ?? null
        };
    });
}

export function getCurrentUserId(): string {
    return UserStore.getCurrentUser()?.id ?? "";
}

export function getCurrentUserDisplayName(): string {
    const current = UserStore.getCurrentUser();
    if (!current) return "";
    return current.globalName || current.username || current.id || "";
}
