/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { fetchBuffer, fetchJson } from "@main/utils/http";
import { IpcEvents } from "@shared/IpcEvents";
import { VENCORD_USER_AGENT } from "@shared/vencordUserAgent";
import { app, ipcMain } from "electron";
import { existsSync, readFileSync, writeFileSync } from "original-fs";
import { join } from "path";

import gitHash from "~git-hash";
import gitRemote from "~git-remote";

import { ASAR_FILE, serializeErrors } from "./common";

const API_BASE = `https://api.github.com/repos/${gitRemote}`;
let PendingUpdate: string | null = null;
let PendingAssetSignature: string | null = null;
let PendingAsarFileName: string | null = null;
const UPDATER_STATE_FILE = join(app.getPath("userData"), "updater-state.json");

function getRuntimeAsarFileName(): string | null {
    const normalizedDir = __dirname.replace(/\\/g, "/");
    const match = normalizedDir.match(/\/([^/]+\.asar)(?:\/|$)/i);
    return match?.[1] ?? null;
}

function getAsarCandidates(): string[] {
    const runtimeName = getRuntimeAsarFileName();
    const names = [runtimeName, ASAR_FILE];

    if (ASAR_FILE === "bashbop.asar" || runtimeName === "bashbop.asar") {
        names.push("equibop.asar");
    }

    if (runtimeName === "equibop.asar") {
        names.push("bashbop.asar");
    }

    // Keep order and remove null/duplicates.
    return [...new Set(names.filter(Boolean) as string[])];
}

function getLastAppliedAssetSignature(): string | null {
    try {
        if (!existsSync(UPDATER_STATE_FILE)) return null;
        const raw = readFileSync(UPDATER_STATE_FILE, "utf8");
        const parsed = JSON.parse(raw);
        const sig = String(parsed?.lastAppliedAssetSignature ?? "").trim();
        return sig.length > 0 ? sig : null;
    } catch {
        return null;
    }
}

function setLastAppliedAssetSignature(signature: string) {
    try {
        writeFileSync(UPDATER_STATE_FILE, JSON.stringify({ lastAppliedAssetSignature: signature }), { flush: true });
    } catch {
        // If state write fails, updater still works; we just lose loop protection persistence.
    }
}

function getAssetSignature(asset: any): string {
    return [
        String(asset?.id ?? ""),
        String(asset?.updated_at ?? ""),
        String(asset?.size ?? "")
    ].join(":");
}

function extractCommitHash(releaseData: any): string | null {
    const hashPattern = /\b[0-9a-f]{7,40}\b/i;
    const candidates = [
        String(releaseData?.name ?? ""),
        String(releaseData?.body ?? ""),
        String(releaseData?.target_commitish ?? "")
    ];

    for (const candidate of candidates) {
        const match = candidate.match(hashPattern);
        if (match?.[0]) {
            return match[0].toLowerCase();
        }
    }

    return null;
}

async function githubGet<T = any>(endpoint: string) {
    return fetchJson<T>(API_BASE + endpoint, {
        headers: {
            Accept: "application/vnd.github+json",
            // "All API requests MUST include a valid User-Agent header.
            // Requests with no User-Agent header will be rejected."
            "User-Agent": VENCORD_USER_AGENT
        }
    });
}

async function calculateGitChanges() {
    const isOutdated = await fetchUpdates();
    if (!isOutdated) return [];

    const data = await githubGet(`/compare/${gitHash}...HEAD`);

    return data.commits.map((c: any) => ({
        hash: c.sha,
        author: c.author?.login ?? c.commit?.author?.name ?? "Ghost",
        message: c.commit.message.split("\n")[0]
    }));
}

async function fetchUpdates() {
    const data = await githubGet("/releases/latest");

    const releaseHash = extractCommitHash(data);
    const currentHash = String(gitHash).toLowerCase();

    // If release metadata provides a commit hash and we already run it, do not re-offer update.
    if (releaseHash && (currentHash === releaseHash || currentHash.startsWith(releaseHash)))
        return false;

    const asarCandidates = getAsarCandidates();
    const asset = data.assets.find(a => asarCandidates.includes(a.name));
    if (!asset?.browser_download_url) {
        throw new Error(`No release asset found for ${asarCandidates.join(" / ")}`);
    }

    const assetSignature = getAssetSignature(asset);
    const lastAppliedAssetSignature = getLastAppliedAssetSignature();
    if (lastAppliedAssetSignature && assetSignature === lastAppliedAssetSignature) {
        return false;
    }

    PendingUpdate = asset.browser_download_url;
    PendingAssetSignature = assetSignature;
    PendingAsarFileName = asset.name;

    return true;
}

async function applyUpdates() {
    if (!PendingUpdate) return true;

    const data = await fetchBuffer(PendingUpdate);

    // __dirname points inside an asar path (e.g. .../desktop.asar/dist/main/updater).
    const normalizedDir = __dirname.replace(/\\/g, "/");
    const runtimeAsarName = getRuntimeAsarFileName();
    const preferredAsarName = runtimeAsarName || PendingAsarFileName || ASAR_FILE;
    const marker = `/${preferredAsarName}`;
    const markerIndex = normalizedDir.indexOf(marker);
    const asarPath = markerIndex >= 0
        ? __dirname.slice(0, markerIndex + marker.length)
        : join(__dirname, "..", "..", preferredAsarName);

    writeFileSync(asarPath, data, { flush: true });

    if (PendingAssetSignature) {
        setLastAppliedAssetSignature(PendingAssetSignature);
    }

    PendingUpdate = null;
    PendingAssetSignature = null;
    PendingAsarFileName = null;

    return true;
}

ipcMain.handle(IpcEvents.GET_REPO, serializeErrors(() => `https://github.com/${gitRemote}`));
ipcMain.handle(IpcEvents.GET_UPDATES, serializeErrors(calculateGitChanges));
ipcMain.handle(IpcEvents.UPDATE, serializeErrors(fetchUpdates));
ipcMain.handle(IpcEvents.BUILD, serializeErrors(applyUpdates));
