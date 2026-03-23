/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DiffResult } from "./diff";
import { FriendEntry } from "./extractor";
import { settings } from "./settings";

export interface AccountDiff {
    sourceAccountId: string;
    sourceAccountName?: string;
    currentAccountId: string;
    currentAccountName?: string;
    result: DiffResult;
    timestamp: number;
}

export interface FriendSyncStatus {
    message: string;
    tone: "info" | "success" | "error";
    timestamp: number;
}

export interface SourceFriendsPreview {
    accountId: string;
    accountName: string;
    friends: FriendEntry[];
    timestamp: number;
}

let latestDiffs: AccountDiff[] = [];
let latestStatus: FriendSyncStatus | null = null;
let latestSourceFriends: SourceFriendsPreview | null = null;

function debugLog(message: string, ...rest: unknown[]): void {
    if (!settings.store.debugLogs) return;
    console.log("[FriendSync]", message, ...rest);
}

export function getLatestDiffs(): AccountDiff[] {
    return latestDiffs;
}

export function setLatestDiffs(diffs: AccountDiff[]): void {
    latestDiffs = diffs;
}

export function getLatestStatus(): FriendSyncStatus | null {
    return latestStatus;
}

export function setLatestStatus(message: string, tone: FriendSyncStatus["tone"] = "info"): void {
    latestStatus = {
        message,
        tone,
        timestamp: Date.now()
    };
}

export function getLatestSourceFriends(): SourceFriendsPreview | null {
    return latestSourceFriends;
}

export function setLatestSourceFriends(preview: Omit<SourceFriendsPreview, "timestamp">): void {
    latestSourceFriends = {
        ...preview,
        timestamp: Date.now()
    };
}

export function clearLatestSourceFriends(): void {
    latestSourceFriends = null;
}

export function startWatcher(): void {
    debugLog("Watcher demarre en mode import/export uniquement.");
    latestDiffs = [];
    latestStatus = null;
    latestSourceFriends = null;
}

export function stopWatcher(): void {
    debugLog("Watcher stop en mode import/export uniquement.");
    latestDiffs = [];
    latestStatus = null;
    latestSourceFriends = null;
}
