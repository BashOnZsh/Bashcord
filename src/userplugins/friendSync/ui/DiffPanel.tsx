/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, Forms, React } from "@webpack/common";

import { extractFriends, FriendEntry, getCurrentUserDisplayName, getCurrentUserId } from "../extractor";
import { settings } from "../settings";
import { clearAllImportedSnapshots, exportSnapshotsToJson, importSnapshotsFromJson, listSnapshots, saveSnapshotWithAccountName } from "../storage";
import { clearLatestSourceFriends, getLatestSourceFriends, setLatestDiffs, setLatestSourceFriends, setLatestStatus } from "../watcher";
import { openFriendsCategoryView } from "./FriendsCategory";

function displayFriendName(friend: { globalName: string | null; username: string; userId: string; }): string {
    return `${friend.globalName ?? friend.username} (${friend.userId})`;
}

export function DiffPanel() {
    const [sourceAccountId, setSourceAccountId] = React.useState<string>("");
    const [availableAccountIds, setAvailableAccountIds] = React.useState<string[]>([]);
    const [accountLabels, setAccountLabels] = React.useState<Record<string, string>>({});
    const [statusText, setStatusText] = React.useState<string>("Chargement...");
    const initializedRef = React.useRef(false);

    const previewLimit = Math.max(5, Number(settings.store.previewLimit) || 30);

    const debugLog = React.useCallback((message: string, ...rest: unknown[]) => {
        if (!settings.store.debugLogs) return;
        console.log("[FriendSync]", message, ...rest);
    }, []);

    const getLabel = (id: string): string => accountLabels[id] || id;

    const refreshSnapshots = React.useCallback(async (): Promise<{
        byUserId: Record<string, FriendEntry[]>;
        ids: string[];
        labels: Record<string, string>;
    }> => {
        const entries = await listSnapshots();
        const ids = entries.map(entry => entry.userId);
        const byUserId: Record<string, FriendEntry[]> = {};
        const nextLabels: Record<string, string> = {};

        for (const entry of entries) {
            byUserId[entry.userId] = entry.snapshot.friends;
            nextLabels[entry.userId] = entry.displayName;
        }

        setAvailableAccountIds(ids);
        setAccountLabels(nextLabels);

        return {
            byUserId,
            ids,
            labels: nextLabels
        };
    }, []);

    const loadSourceList = React.useCallback(async (forcedSourceId?: string) => {
        const { byUserId, ids: rawIds, labels } = await refreshSnapshots();
        const ids: string[] = rawIds;
        const resolveLabel = (id: string): string => labels[id] || id;

        if (ids.length < 1) {
            const message = "Aucune liste importee. Exporte puis importe un JSON FriendSync.";
            setStatusText(message);
            setLatestStatus(message, "info");
            setSourceAccountId("");
            setLatestDiffs([]);
            clearLatestSourceFriends();
            return;
        }

        const nextSourceId = forcedSourceId && ids.includes(forcedSourceId)
            ? forcedSourceId
            : (sourceAccountId && ids.includes(sourceAccountId) ? sourceAccountId : ids[0]);
        const sourceFriends = byUserId[nextSourceId];

        if (!sourceFriends) {
            const message = "Impossible de charger la liste selectionnee.";
            setStatusText(message);
            setLatestStatus(message, "error");
            setLatestDiffs([]);
            return;
        }

        setSourceAccountId(nextSourceId);
        const message = `Liste chargee: ${resolveLabel(nextSourceId)} (${sourceFriends.length} ami(s)).`;
        setStatusText(message);
        setLatestStatus(message, "success");
        setLatestDiffs([]);
        setLatestSourceFriends({
            accountId: nextSourceId,
            accountName: resolveLabel(nextSourceId),
            friends: sourceFriends
        });

        debugLog("Liste source chargee", {
            source: resolveLabel(nextSourceId),
            total: sourceFriends.length
        });
    }, [debugLog, refreshSnapshots, sourceAccountId]);

    React.useEffect(() => {
        if (initializedRef.current) return;
        initializedRef.current = true;
        void loadSourceList();
    }, [loadSourceList]);

    const captureCurrentAccountSnapshot = React.useCallback(async (): Promise<{ accountId: string; accountName: string; count: number; }> => {
        const accountId = getCurrentUserId();
        if (!accountId) {
            throw new Error("Compte courant introuvable");
        }

        const friends = extractFriends();
        const accountName = getCurrentUserDisplayName() || accountId;
        await saveSnapshotWithAccountName(accountId, accountName, friends);
        setLatestSourceFriends({ accountId, accountName, friends });
        setLatestDiffs([]);

        debugLog("Snapshot source mis a jour avant export.", {
            accountId,
            accountName,
            friends: friends.length
        });

        return {
            accountId,
            accountName,
            count: friends.length
        };
    }, [debugLog]);

    const exportJson = React.useCallback(async () => {
        try {
            const capture = await captureCurrentAccountSnapshot();
            const json = await exportSnapshotsToJson();
            const blob = new Blob([json], { type: "application/json" });
            const url = URL.createObjectURL(blob);

            const fileName = `friendsync-export-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = fileName;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);

            URL.revokeObjectURL(url);
            const message = `Export JSON termine. Source mise a jour: ${capture.accountName} (${capture.count} ami(s)).`;
            setStatusText(message);
            setLatestStatus(message, "success");
            debugLog("Export JSON reussi.");
        } catch (error) {
            console.error("[FriendSync] Erreur export JSON:", error);
            const message = "Echec de l'export JSON.";
            setStatusText(message);
            setLatestStatus(message, "error");
        }
    }, [captureCurrentAccountSnapshot, debugLog]);

    const importJson = React.useCallback(() => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/json,.json";
        input.onchange = async event => {
            const target = event.target as HTMLInputElement;
            const file = target.files?.[0];
            if (!file) return;

            try {
                const jsonText = await file.text();
                const result = await importSnapshotsFromJson(jsonText);
                const message = `Import termine: ${result.imported} compte(s), ${result.createdEntries} entree(s) creee(s), ${result.skipped} ignore(s).`;
                setStatusText(message);
                setLatestStatus(message, result.imported > 0 ? "success" : "info");

                debugLog("Import JSON reussi.", result);

                try {
                    await captureCurrentAccountSnapshot();
                } catch (captureError) {
                    debugLog("Capture du compte courant apres import impossible.", captureError);
                }

                await loadSourceList();
                openFriendsCategoryView();
            } catch (error) {
                console.error("[FriendSync] Erreur import JSON:", error);
                const message = error instanceof Error ? error.message : "Fichier invalide";
                const status = `Echec import JSON: ${message}`;
                setStatusText(status);
                setLatestStatus(status, "error");
            }
        };

        input.click();
    }, [captureCurrentAccountSnapshot, debugLog, loadSourceList]);

    const cleanImports = React.useCallback(async () => {
        const confirmed = window.confirm("Supprimer tous les snapshots importes FriendSync ?");
        if (!confirmed) return;

        try {
            const result = await clearAllImportedSnapshots();

            setLatestDiffs([]);
            setSourceAccountId("");
            setAvailableAccountIds([]);
            setAccountLabels({});
            clearLatestSourceFriends();
            const message = "Tous les imports ont ete nettoyes.";
            setStatusText(message);
            setLatestStatus(message, "success");

            debugLog("Clean imports reussi.", result);
            await loadSourceList();
        } catch (error) {
            console.error("[FriendSync] Erreur clean imports:", error);
            const message = "Echec du nettoyage des imports.";
            setStatusText(message);
            setLatestStatus(message, "error");
        }
    }, [debugLog, loadSourceList]);

    const renderLimitedFriends = React.useCallback((friends: FriendEntry[], tone: "muted" | "normal") => {
        const visibleFriends = friends.slice(0, previewLimit);
        const hiddenCount = Math.max(0, friends.length - visibleFriends.length);

        return (
            <>
                {visibleFriends.length > 0 ? visibleFriends.map(friend => (
                    <div
                        key={friend.userId}
                        style={{
                            padding: "4px 0",
                            color: tone === "muted" ? "var(--text-muted)" : "var(--text-normal)"
                        }}
                    >
                        {displayFriendName(friend)}
                    </div>
                )) : <Forms.FormText>Aucun.</Forms.FormText>}
                {hiddenCount > 0 && (
                    <Forms.FormText>
                        ... {hiddenCount} ami(s) non affiche(s) pour eviter les lags.
                    </Forms.FormText>
                )}
            </>
        );
    }, [previewLimit]);

    const sourcePreview = getLatestSourceFriends();

    return (
        <div style={{ padding: "16px" }}>
            <Forms.FormTitle>Liste d'amis importee</Forms.FormTitle>
            <Forms.FormText style={{ marginBottom: "8px" }}>{statusText}</Forms.FormText>

            <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
                <Button onClick={() => void loadSourceList()}>Actualiser</Button>
                <Button onClick={() => void exportJson()}>Exporter JSON</Button>
                <Button onClick={() => void importJson()}>Importer JSON</Button>
                <Button color={Button.Colors.RED} onClick={() => void cleanImports()}>Clean imports</Button>
                {availableAccountIds.map((id: string) => (
                    <Button
                        key={`source-${id}`}
                        color={id === sourceAccountId ? Button.Colors.BRAND : Button.Colors.PRIMARY}
                        onClick={() => void loadSourceList(id)}
                    >
                        Liste: {getLabel(id)}
                    </Button>
                ))}
            </div>

            <Forms.FormText style={{ marginBottom: "12px" }}>
                Apercu affiche: {previewLimit} ami(s) max par section.
            </Forms.FormText>

            <div>
                <Forms.FormText>{statusText}</Forms.FormText>
                {sourcePreview?.friends ? (
                    <section style={{ marginTop: "12px" }}>
                        <Forms.FormTitle tag="h5" style={{ color: "var(--status-positive)" }}>
                            Liste d'amis source ({sourcePreview.accountName}) - {sourcePreview.friends.length}
                        </Forms.FormTitle>
                        {renderLimitedFriends(sourcePreview.friends, "normal")}
                    </section>
                ) : null}
            </div>
        </div>
    );
}
