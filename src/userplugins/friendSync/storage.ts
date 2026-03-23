/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";

import { FriendEntry } from "./extractor";
import { settings } from "./settings";

const KEY_PREFIX = "FriendSync_snapshot_";
const INDEX_KEY = "FriendSync_snapshot_index";
const NAMES_KEY = "FriendSync_account_names";

export interface SnapshotData {
    timestamp: number;
    friends: FriendEntry[];
}

export interface FriendSyncExportData {
    version: 1;
    exportedAt: number;
    snapshots: Record<string, SnapshotData>;
    accountNames?: Record<string, string>;
}

export interface FriendSyncImportResult {
    imported: number;
    skipped: number;
    total: number;
    createdEntries: number;
}

export interface FriendSyncCleanResult {
    removedSnapshots: number;
}

interface SnapshotIndex {
    userIds: string[];
}

interface AccountNames {
    [userId: string]: string;
}

function debugLog(message: string, ...rest: unknown[]): void {
    if (!settings.store.debugLogs) return;
    console.log("[FriendSync]", message, ...rest);
}

function getSnapshotKey(userId: string): string {
    return `${KEY_PREFIX}${userId}`;
}

function isFriendEntry(value: unknown): value is FriendEntry {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<FriendEntry>;
    return typeof candidate.userId === "string"
        && typeof candidate.username === "string"
        && (typeof candidate.globalName === "string" || candidate.globalName == null);
}

function normalizeSnapshotData(raw: unknown): SnapshotData | null {
    if (!raw || typeof raw !== "object") return null;

    const candidate = raw as Partial<SnapshotData>;
    if (typeof candidate.timestamp !== "number" || !Array.isArray(candidate.friends)) return null;

    const friends = candidate.friends.filter(isFriendEntry);

    return {
        timestamp: candidate.timestamp,
        friends
    };
}

async function loadIndex(): Promise<SnapshotIndex> {
    const raw = await DataStore.get<SnapshotIndex>(INDEX_KEY);

    if (!raw || !Array.isArray(raw.userIds)) {
        return { userIds: [] };
    }

    return {
        userIds: raw.userIds.filter((id: unknown): id is string => typeof id === "string")
    };
}

async function saveIndex(index: SnapshotIndex): Promise<void> {
    const uniqueUserIds = [...new Set(index.userIds)];
    await DataStore.set(INDEX_KEY, { userIds: uniqueUserIds });
}

async function loadAccountNames(): Promise<AccountNames> {
    const raw = await DataStore.get<AccountNames>(NAMES_KEY);
    if (!raw || typeof raw !== "object") return {};

    const names: AccountNames = {};
    for (const [userId, value] of Object.entries(raw)) {
        if (typeof userId === "string" && typeof value === "string" && value.trim()) {
            names[userId] = value.trim();
        }
    }

    return names;
}

async function saveAccountNames(names: AccountNames): Promise<void> {
    await DataStore.set(NAMES_KEY, names);
}

async function upsertSnapshot(userId: string, snapshot: SnapshotData): Promise<boolean> {
    await DataStore.set(getSnapshotKey(userId), snapshot);

    const index = await loadIndex();
    if (!index.userIds.includes(userId)) {
        index.userIds.push(userId);
        await saveIndex(index);
        debugLog("Entree de compte creee dans la section snapshots:", userId);
        return true;
    }

    return false;
}

export async function saveSnapshot(userId: string, friends: FriendEntry[]): Promise<void> {
    const snapshot: SnapshotData = {
        timestamp: Date.now(),
        friends
    };

    await upsertSnapshot(userId, snapshot);
    debugLog("Snapshot sauvegarde:", userId, `(${friends.length} amis)`);
}

export async function saveSnapshotWithAccountName(userId: string, displayName: string, friends: FriendEntry[]): Promise<void> {
    await saveSnapshot(userId, friends);

    const trimmedName = displayName.trim();
    if (!trimmedName) return;

    const names = await loadAccountNames();
    if (names[userId] !== trimmedName) {
        names[userId] = trimmedName;
        await saveAccountNames(names);
    }
}

export async function loadSnapshot(userId: string): Promise<SnapshotData | null> {
    const raw = await DataStore.get<SnapshotData>(getSnapshotKey(userId));
    return normalizeSnapshotData(raw);
}

export async function listSnapshotUserIds(): Promise<string[]> {
    const index = await loadIndex();
    return index.userIds;
}

export async function listSnapshots(): Promise<Array<{ userId: string; displayName: string; snapshot: SnapshotData; }>> {
    const userIds = await listSnapshotUserIds();
    const accountNames = await loadAccountNames();
    const items: Array<{ userId: string; displayName: string; snapshot: SnapshotData; }> = [];

    for (const userId of userIds) {
        const snapshot = await loadSnapshot(userId);
        if (!snapshot) continue;
        items.push({
            userId,
            displayName: accountNames[userId] || userId,
            snapshot
        });
    }

    return items;
}

export async function getAccountDisplayName(userId: string): Promise<string> {
    const names = await loadAccountNames();
    return names[userId] || userId;
}

export async function exportSnapshotsToJson(): Promise<string> {
    const userIds = await listSnapshotUserIds();
    const snapshots: Record<string, SnapshotData> = {};
    const accountNames = await loadAccountNames();

    for (const userId of userIds) {
        const snapshot = await loadSnapshot(userId);
        if (!snapshot) continue;
        snapshots[userId] = snapshot;
    }

    const payload: FriendSyncExportData = {
        version: 1,
        exportedAt: Date.now(),
        snapshots,
        accountNames
    };

    debugLog("Export JSON termine. Comptes exportes:", Object.keys(snapshots).length);
    return JSON.stringify(payload, null, 2);
}

export async function importSnapshotsFromJson(jsonText: string): Promise<FriendSyncImportResult> {
    let parsed: unknown;

    try {
        parsed = JSON.parse(jsonText);
    } catch {
        throw new Error("JSON invalide");
    }

    if (!parsed || typeof parsed !== "object") {
        throw new Error("Format invalide");
    }

    const payload = parsed as Partial<FriendSyncExportData>;
    if (!payload.snapshots || typeof payload.snapshots !== "object") {
        throw new Error("Format FriendSync invalide: snapshots manquants");
    }

    const entries = Object.entries(payload.snapshots as Record<string, unknown>);
    if (entries.length === 0) {
        throw new Error("Aucun snapshot dans le JSON importe");
    }

    const importedNames = payload.accountNames && typeof payload.accountNames === "object"
        ? payload.accountNames as Record<string, unknown>
        : {};

    const currentNames = await loadAccountNames();
    let imported = 0;
    let skipped = 0;
    let createdEntries = 0;

    for (const [userId, rawSnapshot] of entries) {
        if (!userId || typeof userId !== "string") {
            skipped++;
            continue;
        }

        const snapshot = normalizeSnapshotData(rawSnapshot);
        if (!snapshot) {
            skipped++;
            continue;
        }

        const created = await upsertSnapshot(userId, snapshot);
        if (created) createdEntries++;

        const importedName = importedNames[userId];
        if (typeof importedName === "string" && importedName.trim()) {
            currentNames[userId] = importedName.trim();
        }

        imported++;
    }

    if (imported === 0) {
        throw new Error("Aucun snapshot valide trouve dans le JSON");
    }

    await saveAccountNames(currentNames);

    debugLog("Import JSON termine.", { imported, skipped, total: entries.length, createdEntries });

    return {
        imported,
        skipped,
        total: entries.length,
        createdEntries
    };
}

export async function clearAllImportedSnapshots(): Promise<FriendSyncCleanResult> {
    const userIds = await listSnapshotUserIds();

    for (const userId of userIds) {
        await DataStore.del(getSnapshotKey(userId));
    }

    await DataStore.del(INDEX_KEY);
    await DataStore.del(NAMES_KEY);

    debugLog("Nettoyage des imports termine.", { removedSnapshots: userIds.length });

    return {
        removedSnapshots: userIds.length
    };
}
