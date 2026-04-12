/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
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

import { HeaderBarButton } from "@api/HeaderBar";
import { cl } from "@equicordplugins/messageLoggerEnhanced/index";
import { findComponentByCodeLazy } from "@webpack";

import { Native } from "..";
import { openLogModal } from "./LogsModal";

const Icon = findComponentByCodeLazy("0-1.27-.97l-2.5.7a3");

function LogsFolderIcon() {
    return (
        <svg aria-hidden="true" role="img" width="24" height="24" viewBox="0 0 24 24">
            <path
                fill="currentColor"
                d="M10 4H4C2.9 4 2 4.9 2 6v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2zM4 6h5.2l2 2H20v10H4V6zm2 3v2h12V9H6zm0 4v2h8v-2H6z"
            />
        </svg>
    );
}

async function openLogsFolder() {
    await Native.openLogsFolder();
}

export function OpenLogsButton() {
    return <>
        <HeaderBarButton
            className={cl("toolbox-btn")}
            onClick={() => openLogModal()}
            tooltip={"Open Logs"}
            icon={Icon}
        />
        <HeaderBarButton
            className={cl("toolbox-btn")}
            onClick={() => openLogsFolder()}
            tooltip={"Open Logs Folder"}
            icon={LogsFolderIcon}
        />
    </>;
}

export { Icon as LogsIcon };
