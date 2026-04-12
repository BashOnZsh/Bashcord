// @ts-nocheck

import { showNotification } from "@api/Notifications";
import { GuildMemberStore, UserStore } from "@webpack/common";

import { EVENT_JOIN, EVENT_LEAVE, addVoiceLog, getEventColor } from "./state";

function getAvatarUrl(user, size) {
    if (!user?.getAvatarURL) {
        return "https://cdn.discordapp.com/embed/avatars/0.png";
    }

    return user.getAvatarURL(null, size) || "https://cdn.discordapp.com/embed/avatars/0.png";
}

function processVoiceEvent(userId, guildId, type) {
    const user = UserStore.getUser(userId);
    if (!user) return false;

    const member = GuildMemberStore.getMember(guildId, userId);
    const displayName = member?.nick || user.globalName || user.username;

    const inserted = addVoiceLog({
        userId,
        username: user.username,
        displayName,
        guildId,
        type
    });

    if (!inserted) return false;

    showNotification({
        title: "Voice Activity",
        body: `${displayName} ${type === EVENT_LEAVE ? "left" : "joined"} the voice channel`,
        color: getEventColor(type),
        icon: getAvatarUrl(user, 64)
    });

    return true;
}

export function handleVoiceStateUpdates(voiceStates, currentChannelId, currentUserId, onLogAdded) {
    for (const { userId, channelId, oldChannelId, guildId } of voiceStates) {
        if (userId === currentUserId) continue;

        const joined = channelId === currentChannelId && oldChannelId !== currentChannelId;
        const left = oldChannelId === currentChannelId && channelId !== currentChannelId;

        if (joined) {
            if (processVoiceEvent(userId, guildId, EVENT_JOIN)) onLogAdded?.();
        } else if (left) {
            if (processVoiceEvent(userId, guildId, EVENT_LEAVE)) onLogAdded?.();
        }
    }
}
