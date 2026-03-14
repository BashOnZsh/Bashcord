/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { GuildMember, User } from "discord-types/general";

export interface ClientUser extends User {
    id: string;
    discriminator: string;
    globalName: string;
    guildMemberAvatars?: string[];
    username: string;
    avatar?: string;
    banner?: string;
    accentColor?: number;
}

export interface userChange {
    member?: Partial<GuildMember>;
    user?: Partial<ClientUser>;
    messageAuthor?: Partial<MessageAuthor>;
    name?: string;
    url?: string;
    banner?: string;
    color1?: string;
    color2?: string;
    status?: string;
    statusEmoji?: any;
    tag?: string;
    tagEmoji?: any;
    removeIcon?: boolean;
    removeBanner?: boolean;
    removeStatus?: boolean;
}

export interface MessageAuthor {
    colorRoleName?: string;
    colorString?: string;
    guildMemberAvatar?: string;
    iconRoleId?: string;
    nick?: string;
}
