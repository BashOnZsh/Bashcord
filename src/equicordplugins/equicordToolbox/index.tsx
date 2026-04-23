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

import "./styles.css";

import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings, migratePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Popout, useRef, useState } from "@webpack/common";

import { renderPopout } from "./menu";

export const settings = definePluginSettings({
    showPluginMenu: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show the plugins menu in the toolbox",
    }
});

function Icon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" width={20} height={20} {...props}>
            <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.2" />
            <path fill="currentColor" d="M7.5 8.2 11 11l-3.5 2.8v-1.9l1.2-.9-1.2-.9V8.2Z" />
            <path fill="currentColor" d="M12.2 14h4.3v1.6h-4.3z" />
            <path fill="currentColor" d="M13.3 7.3h1.9c1.6 0 2.8.8 2.8 2.2 0 .8-.4 1.4-1 1.8.9.3 1.5 1 1.5 2 0 1.5-1.2 2.5-3 2.5h-2.2V7.3Zm1.7 3.3h.8c.8 0 1.2-.3 1.2-.9s-.4-.8-1.2-.8H15v1.7Zm0 3.4h1c.9 0 1.4-.3 1.4-1s-.5-1-1.4-1h-1V14Z" />
        </svg>
    );
}

function VencordPopoutButton() {
    const buttonRef = useRef(null);
    const [show, setShow] = useState(false);

    return (
        <Popout
            position="bottom"
            align="center"
            spacing={0}
            animation={Popout.Animation.NONE}
            shouldShow={show}
            onRequestClose={() => setShow(false)}
            targetElementRef={buttonRef}
            renderPopout={() => renderPopout(() => setShow(false))}
        >
            {(_, { isShown }) => (
                <HeaderBarButton
                    ref={buttonRef}
                    className="vc-toolbox-btn"
                    onClick={() => setShow(v => !v)}
                    tooltip={isShown ? null : "Bashcord Toolbox"}
                    icon={Icon}
                    selected={isShown}
                />
            )}
        </Popout>
    );
}

migratePluginSettings("BashcordToolbox", "EquicordToolbox", "VencordToolbox");
export default definePlugin({
    name: "BashcordToolbox",
    description: "Adds a button next to the inbox button in the channel header that houses Bashcord quick actions",
    authors: [Devs.Ven, Devs.AutumnVN],
    dependencies: ["HeaderBarAPI"],

    settings,

    headerBarButton: {
        icon: Icon,
        render: VencordPopoutButton,
        priority: 1337
    }
});
