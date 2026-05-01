/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Notice } from "@components/Notice";
import { EquicordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { User, VoiceState } from "@vencord/discord-types";
import { ChannelActions, ChannelStore, Menu, React, UserStore, VoiceStateStore } from "@webpack/common";

type TFollowedUserInfo = {
    userId: string;
} | null;

interface UserContextProps {
    user: User;
}

let followedUserInfo: TFollowedUserInfo = null;

// Helper function for logging
const logDebug = (message: string, data?: any) => {
    if (settings.store.enableDebugLogging) {
        console.log(`[FollowVoiceUser] ${message}`, data ?? "");
    }
};

const logError = (message: string, error?: any) => {
    console.error(`[FollowVoiceUser] ERROR: ${message}`, error ?? "");
};

const settings = definePluginSettings({
    leaveWhenUserLeaves: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Leave the voice channel when the user leaves. (Can cause infinite loops if two users follow each other)"
    },
    showNotifications: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show notifications in console when following/unfollowing users"
    },
    enableDebugLogging: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Enable debug logging in console for troubleshooting"
    }
});

const UserContextMenuPatch: NavContextMenuPatchCallback = (children, { user }: UserContextProps) => {
    try {
        if (!UserStore || !user?.id) return;

        const currentUser = UserStore.getCurrentUser();
        if (!currentUser || currentUser.id === user.id) return;

        const [checked, setChecked] = React.useState(followedUserInfo?.userId === user.id);

        const handleToggleFollowing = () => {
            try {
                if (followedUserInfo?.userId === user.id) {
                    followedUserInfo = null;
                    setChecked(false);
                    if (settings.store.showNotifications) {
                        console.log(`[FollowVoiceUser] Stopped following ${user.username}`);
                    }
                    return;
                }

                // Set following info
                followedUserInfo = { userId: user.id };
                setChecked(true);
                if (settings.store.showNotifications) {
                    console.log(`[FollowVoiceUser] Now following ${user.username}`);
                }

                // Immediately check their status and join if they are in a channel
                const userVoiceState = VoiceStateStore.getVoiceStateForUser(user.id);
                if (userVoiceState?.channelId) {
                    if (ChannelStore.getChannel(userVoiceState.channelId)) {
                        ChannelActions.selectVoiceChannel(userVoiceState.channelId);
                        logDebug(`Joined channel: ${userVoiceState.channelId} to follow ${user.username}`);
                    } else {
                        logDebug(`User is in channel ${userVoiceState.channelId} but it's not loaded yet.`);
                    }
                }
            } catch (err) {
                logError("Failed to toggle following", err);
                setChecked(false);
            }
        };

        children.push(
            <Menu.MenuSeparator />,
            <Menu.MenuCheckboxItem
                id="fvu-follow-user"
                label="Follow User"
                checked={checked}
                action={handleToggleFollowing}
            />
        );
    } catch (err) {
        logError("Error in UserContextMenuPatch", err);
    }
};

export default definePlugin({
    name: "FollowVoiceUser",
    description: "Follow a user in voice chat automatically.",
    authors: [EquicordDevs.TheArmagan],
    settings,
    settingsAboutComponent: () => (
        <Notice.Info>
            This plugin allows you to automatically follow a user when they move between voice channels.
        </Notice.Info>
    ),
    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            if (!followedUserInfo) return;

            // Check if our target user is part of the update
            const hasUpdate = voiceStates.some(vs => vs.userId === followedUserInfo!.userId);
            if (!hasUpdate) return;

            // Small timeout to ensure the store has been updated with the latest information
            // This ensures maximum reliability and prevents race conditions with Discord's state
            setTimeout(() => {
                try {
                    if (!followedUserInfo) return;

                    const targetVoiceState = VoiceStateStore.getVoiceStateForUser(followedUserInfo.userId);
                    const currentUser = UserStore.getCurrentUser();
                    if (!currentUser) return;

                    const myVoiceState = VoiceStateStore.getVoiceStateForUser(currentUser.id);

                    const targetChannelId = targetVoiceState?.channelId;
                    const myChannelId = myVoiceState?.channelId;

                    // Only take action if they are in a different channel than us
                    if (targetChannelId && targetChannelId !== myChannelId) {
                        logDebug(`Target user moved to ${targetChannelId}, following...`);
                        
                        // Ensure the channel exists in our local store before trying to join
                        if (ChannelStore.getChannel(targetChannelId)) {
                            ChannelActions.selectVoiceChannel(targetChannelId);
                        } else {
                            logDebug(`Channel ${targetChannelId} is not yet available in the store.`);
                        }
                    }
                    // Handle leaving if enabled
                    else if (!targetChannelId && myChannelId && settings.store.leaveWhenUserLeaves) {
                        logDebug("Target user left voice, following suit...");
                        ChannelActions.selectVoiceChannel(null);
                    }
                } catch (err) {
                    logError("Error in VOICE_STATE_UPDATES handler", err);
                }
            }, 150);
        }
    },
    contextMenus: {
        "user-context": UserContextMenuPatch
    },
    stop() {
        followedUserInfo = null;
    }
});
