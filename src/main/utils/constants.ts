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

import { app } from "electron";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const suffix = IS_DEV ? "dev" : "";

const customDataDir = process.env.BASHCORD_USER_DATA_DIR ?? process.env.DATA_DIR;
const legacyCustomDataDir = process.env.EQUICORD_USER_DATA_DIR;
const discordUserDataDir = process.env.DISCORD_USER_DATA_DIR;

const DATA_PARENT_DIR = discordUserDataDir
    ? join(discordUserDataDir, "..")
    : join(app.getPath("userData"), "..");

function copyDirContents(source: string, target: string) {
    mkdirSync(target, { recursive: true });

    for (const entry of readdirSync(source)) {
        cpSync(join(source, entry), join(target, entry), {
            recursive: true,
            force: false,
            errorOnExist: false
        });
    }
}

function migrateLegacyData(targetDir: string) {
    const legacyDirs = [
        join(DATA_PARENT_DIR, "Equicord", suffix),
        join(DATA_PARENT_DIR, "EquicordData", suffix),
        legacyCustomDataDir
    ].filter(Boolean) as string[];

    for (const legacyDir of legacyDirs) {
        if (!existsSync(legacyDir) || legacyDir === targetDir) continue;

        try {
            copyDirContents(legacyDir, targetDir);
            console.log(`[Bashcord] Migrated data from ${legacyDir} to ${targetDir}`);
        } catch (err) {
            console.error(`[Bashcord] Failed to migrate data from ${legacyDir}:`, err);
        }
    }
}

export const DATA_DIR = customDataDir ?? join(DATA_PARENT_DIR, discordUserDataDir ? "BashcordData" : "Bashcord", suffix);

migrateLegacyData(DATA_DIR);

export const SETTINGS_DIR = join(DATA_DIR, "settings");
export const THEMES_DIR = join(DATA_DIR, "themes");
export const QUICK_CSS_PATH = join(SETTINGS_DIR, "quickCss.css");
export const SETTINGS_FILE = join(SETTINGS_DIR, "settings.json");
export const NATIVE_SETTINGS_FILE = join(SETTINGS_DIR, "native-settings.json");
export const DEV_MIGRATED = join(SETTINGS_DIR, "migration");
export const ALLOWED_PROTOCOLS = [
    "https:",
    "http:",
    "steam:",
    "spotify:",
    "com.epicgames.launcher:",
    "tidal:",
    "itunes:",
    "vrcx:",
];

export const IS_VANILLA = /* @__PURE__ */ process.argv.includes("--vanilla");

if (IS_DEV) {
    const prodDir = join(DATA_DIR, "..");
    const settings = join(prodDir, "settings", "settings.json");
    const quickCss = join(prodDir, "settings", "quickCss.css");

    let migrated = false;
    if (existsSync(DEV_MIGRATED)) {
        const content = readFileSync(DEV_MIGRATED, "utf-8");
        migrated = content.includes("migrated");
    }

    if (!migrated) {
        setTimeout(() => {
            try {
                if (existsSync(settings)) copyFileSync(settings, SETTINGS_FILE);
                if (existsSync(quickCss)) copyFileSync(quickCss, QUICK_CSS_PATH);
                writeFileSync(DEV_MIGRATED, "migrated");
                app.relaunch();
                app.exit(0);
            } catch (err) {
                console.error("[Equicord] Failed to copy prod data:", err);
            }
        }, 5000);
    }
}
