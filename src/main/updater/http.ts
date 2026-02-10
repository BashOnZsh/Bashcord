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
import { ipcMain } from "electron";
import { writeFileSync } from "original-fs";

import gitHash from "~git-hash";
import gitRemote from "~git-remote";

import { ASAR_FILE, serializeErrors } from "./common";

const API_BASE = `https://api.github.com/repos/${gitRemote}`;
let PendingUpdate: string | null = null;

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

function extractHash(value: string | undefined | null) {
    if (!value) return null;

    const matches = value.match(/[0-9a-f]{7,40}/gi);
    return matches?.[matches.length - 1] ?? null;
}

async function getLatestReleaseInfo() {
    const data = await githubGet("/releases/latest");
    let latestHash = extractHash(data.name) ?? extractHash(data.tag_name);

    if (!latestHash) {
        const ref = data.target_commitish || data.tag_name;
        if (ref) {
            const commit = await githubGet(`/commits/${encodeURIComponent(ref)}`);
            latestHash = commit?.sha ?? null;
        }
    }

    const asset = data.assets?.find(a => a.name === ASAR_FILE);

    return {
        latestHash,
        assetUrl: asset?.browser_download_url ?? null,
    };
}

async function calculateGitChanges() {
    const { latestHash } = await getLatestReleaseInfo();
    if (!latestHash || latestHash === gitHash) return [];

    try {
        const data = await githubGet(`/compare/${gitHash}...${latestHash}`);

        return data.commits.map((c: any) => ({
            hash: c.sha,
            author: c.author?.login ?? c.commit?.author?.name ?? "Ghost",
            message: c.commit.message.split("\n")[0]
        }));
    } catch {
        return [{ hash: latestHash, author: "Release", message: "Update available" }];
    }
}

async function fetchUpdates() {
    const { latestHash, assetUrl } = await getLatestReleaseInfo();
    if (!latestHash || latestHash === gitHash) return false;
    if (!assetUrl) return false;

    PendingUpdate = assetUrl;

    return true;
}

async function applyUpdates() {
    if (!PendingUpdate) return true;

    const data = await fetchBuffer(PendingUpdate);
    writeFileSync(__dirname, data, { flush: true });

    PendingUpdate = null;

    return true;
}

ipcMain.handle(IpcEvents.GET_REPO, serializeErrors(() => `https://github.com/${gitRemote}`));
ipcMain.handle(IpcEvents.GET_UPDATES, serializeErrors(calculateGitChanges));
ipcMain.handle(IpcEvents.UPDATE, serializeErrors(fetchUpdates));
ipcMain.handle(IpcEvents.BUILD, serializeErrors(applyUpdates));
