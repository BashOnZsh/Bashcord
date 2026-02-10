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

import { IpcEvents } from "@shared/IpcEvents";
import { execFile as cpExecFile } from "child_process";
import { ipcMain } from "electron";
import { join } from "path";
import { promisify } from "util";

import { serializeErrors } from "./common";

const VENCORD_SRC_DIR = join(__dirname, "..");
const EQUICORD_DIR = join(__dirname, "../../");

const execFile = promisify(cpExecFile);

const isFlatpak = process.platform === "linux" && !!process.env.FLATPAK_ID;

if (process.platform === "darwin") process.env.PATH = `/usr/local/bin:${process.env.PATH}`;

function git(...args: string[]) {
    const opts = { cwd: VENCORD_SRC_DIR };

    if (isFlatpak) return execFile("flatpak-spawn", ["--host", "git", ...args], opts);
    else return execFile("git", args, opts);
}

async function getCurrentBranch() {
    const res = await git("branch", "--show-current");
    const branch = res.stdout.trim();
    return branch.length > 0 ? branch : null;
}

async function branchExistsOnOrigin(branch: string) {
    const res = await git("ls-remote", "origin", `refs/heads/${branch}`);
    return res.stdout.trim().length > 0;
}

async function getDefaultBranch() {
    try {
        const res = await git("symbolic-ref", "refs/remotes/origin/HEAD");
        const ref = res.stdout.trim();
        const match = ref.match(/refs\/remotes\/origin\/(.+)$/);
        if (match?.[1]) return match[1];
    } catch {
        // ignore
    }

    if (await branchExistsOnOrigin("main")) return "main";
    if (await branchExistsOnOrigin("master")) return "master";

    return null;
}

async function getRemoteBranch() {
    const branch = await getCurrentBranch();
    if (branch) return branch;
    return await getDefaultBranch();
}

async function getRepo() {
    const res = await git("remote", "get-url", "origin");
    return res.stdout.trim()
        .replace(/git@(.+):/, "https://$1/")
        .replace(/\.git$/, "");
}

async function calculateGitChanges() {
    await git("fetch");

    const branch = await getRemoteBranch();
    if (!branch) return [];

    const existsOnOrigin = await branchExistsOnOrigin(branch);
    if (!existsOnOrigin) return [];

    const res = await git("log", `HEAD...origin/${branch}`, "--pretty=format:%an/%h/%s");

    const commits = res.stdout.trim();
    return commits ? commits.split("\n").map(line => {
        const [author, hash, ...rest] = line.split("/");
        return {
            hash, author,
            message: rest.join("/").split("\n")[0]
        };
    }) : [];
}

async function pull() {
    let branch = await getCurrentBranch();
    if (!branch) {
        branch = await getDefaultBranch();
        if (!branch) return false;

        const status = await git("status", "--porcelain");
        if (status.stdout.trim().length > 0) {
            throw new Error("Working tree has uncommitted changes; cannot switch branches for update.");
        }

        await git("checkout", "-B", branch, `origin/${branch}`);
    }

    const res = await git("pull", "--ff-only");
    return res.stdout.includes("Fast-forward") || res.stdout.includes("Updating");
}

async function build() {
    const opts = { cwd: EQUICORD_DIR };

    const command = isFlatpak ? "flatpak-spawn" : "node";
    const args = isFlatpak ? ["--host", "node", "scripts/build/build.mjs"] : ["scripts/build/build.mjs"];

    if (IS_DEV) args.push("--dev");

    const res = await execFile(command, args, opts);

    return !res.stderr.includes("Build failed");
}

ipcMain.handle(IpcEvents.GET_REPO, serializeErrors(getRepo));
ipcMain.handle(IpcEvents.GET_UPDATES, serializeErrors(calculateGitChanges));
ipcMain.handle(IpcEvents.UPDATE, serializeErrors(pull));
ipcMain.handle(IpcEvents.BUILD, serializeErrors(build));
