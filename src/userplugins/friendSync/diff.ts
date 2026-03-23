/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FriendEntry } from "./extractor";

export interface DiffResult {
    onlyInA: FriendEntry[];
    onlyInB: FriendEntry[];
    common: FriendEntry[];
}

function sortByDisplayName(list: FriendEntry[]): FriendEntry[] {
    return [...list].sort((left, right) => {
        const leftName = (left.globalName ?? left.username).toLowerCase();
        const rightName = (right.globalName ?? right.username).toLowerCase();
        return leftName.localeCompare(rightName) || left.userId.localeCompare(right.userId);
    });
}

export function diffFriends(listA: FriendEntry[], listB: FriendEntry[]): DiffResult {
    const setA = new Set(listA.map(friend => friend.userId));
    const setB = new Set(listB.map(friend => friend.userId));

    return {
        onlyInA: sortByDisplayName(listA.filter(friend => !setB.has(friend.userId))),
        onlyInB: sortByDisplayName(listB.filter(friend => !setA.has(friend.userId))),
        common: sortByDisplayName(listA.filter(friend => setB.has(friend.userId)))
    };
}
