/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import * as Modal from "@utils/modal";
import definePlugin from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { Button, ChannelStore, Menu, React, Slider, Text, showToast, Toasts, UserStore } from "@webpack/common";

const VoiceStateStore = findStoreLazy("VoiceStateStore");
const ChannelActions = findByPropsLazy("selectVoiceChannel");

const MINUTE_MS = 60_000;
const MIN_TIMER_MINUTES = 1;
const MAX_TIMER_MINUTES = 240;

let disconnectTimeout: NodeJS.Timeout | null = null;
let scheduledAt = 0;
let scheduledForMs = 0;

function getPrivateVoiceChannelId(): string | null {
    const currentUser = UserStore.getCurrentUser();
    if (!currentUser) return null;

    const voiceState = VoiceStateStore.getVoiceStateForUser(currentUser.id);
    if (!voiceState?.channelId) return null;

    const channel = ChannelStore.getChannel(voiceState.channelId);
    if (!channel) return null;

    const isPrivateCall = channel.type === 1 || channel.type === 3;
    return isPrivateCall ? voiceState.channelId : null;
}

function clearSchedule(showFeedback = false) {
    if (disconnectTimeout) {
        clearTimeout(disconnectTimeout);
        disconnectTimeout = null;
    }

    scheduledAt = 0;
    scheduledForMs = 0;

    if (showFeedback) {
        showToast("Timer AntiSleepcall annule", Toasts.Type.MESSAGE);
    }
}

function scheduleDisconnect(delayMs: number, label: string) {
    if (delayMs <= 0) {
        showToast("Duree invalide", Toasts.Type.FAILURE);
        return;
    }

    const privateChannelId = getPrivateVoiceChannelId();
    if (!privateChannelId) {
        showToast("Tu dois etre dans un appel prive pour planifier la deco", Toasts.Type.FAILURE);
        return;
    }

    if (disconnectTimeout) {
        clearTimeout(disconnectTimeout);
    }

    scheduledAt = Date.now();
    scheduledForMs = delayMs;

    disconnectTimeout = setTimeout(() => {
        disconnectTimeout = null;

        const stillInPrivateCall = getPrivateVoiceChannelId();
        if (!stillInPrivateCall) {
            showToast("Timer termine, mais aucun appel prive actif", Toasts.Type.MESSAGE);
            scheduledAt = 0;
            scheduledForMs = 0;
            return;
        }

        try {
            ChannelActions.selectVoiceChannel(null);
            showToast("Deconnexion de l'appel prive effectuee", Toasts.Type.SUCCESS);
        } catch (error) {
            console.error("[AntiSleepcall] Erreur pendant la deconnexion:", error);
            showToast("Erreur pendant la deconnexion planifiee", Toasts.Type.FAILURE);
        } finally {
            scheduledAt = 0;
            scheduledForMs = 0;
        }
    }, delayMs);

    showToast(`Deconnexion planifiee dans ${label}`, Toasts.Type.SUCCESS);
}

function scheduleDisconnectMinutes(minutes: number) {
    const roundedMinutes = Math.round(minutes);
    scheduleDisconnect(roundedMinutes * MINUTE_MS, `${roundedMinutes} minute(s)`);
}

function getRemainingSeconds(): number {
    if (!disconnectTimeout || !scheduledAt || !scheduledForMs) return 0;

    const remainingMs = Math.max(0, scheduledAt + scheduledForMs - Date.now());
    return Math.ceil(remainingMs / 1000);
}

function getRemainingMinutes(): number {
    const remainingSeconds = getRemainingSeconds();
    return remainingSeconds > 0 ? Math.ceil(remainingSeconds / 60) : 0;
}

type SleepTimerModalProps = Modal.ModalProps & {
    defaultMinutes: number;
    onClose: () => void;
};

const SleepTimerModal = ({ defaultMinutes, onClose, ...props }: SleepTimerModalProps) => {
    const [minutes, setMinutes] = React.useState(defaultMinutes);

    return (
        <Modal.ModalRoot {...props}>
            <Modal.ModalHeader separator={false}>
                <Text variant="heading-lg/semibold">AntiSleepcall</Text>
            </Modal.ModalHeader>
            <Modal.ModalContent>
                <Text variant="text-md/normal" style={{ marginBottom: "12px" }}>
                    Regle la duree avant la deconnexion automatique (en minutes).
                </Text>
                <div style={{ padding: "0 8px 4px" }}>
                    <Slider
                        onValueChange={(value: number) => setMinutes(Math.round(value))}
                        initialValue={minutes}
                        minValue={MIN_TIMER_MINUTES}
                        maxValue={MAX_TIMER_MINUTES}
                        markers={[1, 15, 30, 60, 120, 180, 240]}
                        onValueRender={(value: number) => `${Math.round(value)} min`}
                    />
                </div>
                <Text variant="text-sm/normal" style={{ marginTop: "8px", opacity: 0.9 }}>
                    Valeur actuelle: {minutes} minute(s)
                </Text>
            </Modal.ModalContent>
            <Modal.ModalFooter>
                <Button
                    color={Button.Colors.BRAND}
                    onClick={() => {
                        scheduleDisconnectMinutes(minutes);
                        onClose();
                    }}
                >
                    Planifier
                </Button>
                <Button
                    color={Button.Colors.TRANSPARENT}
                    onClick={onClose}
                >
                    Annuler
                </Button>
            </Modal.ModalFooter>
        </Modal.ModalRoot>
    );
};

function openSleepTimerModal() {
    const activeTimerMinutes = getRemainingMinutes();
    const defaultMinutes = activeTimerMinutes > 0 ? activeTimerMinutes : 30;

    Modal.openModal((props: any) => (
        <SleepTimerModal
            {...props}
            defaultMinutes={defaultMinutes}
            onClose={props.onClose}
        />
    ));
}

const UserContextMenuPatch: NavContextMenuPatchCallback = (children: any[], { user }: { user: any; }) => {
    if (!user) return;

    const group = findGroupChildrenByChildId("close-dm", children) ?? findGroupChildrenByChildId("call", children) ?? children;

    const remainingSeconds = getRemainingSeconds();

    group.push(
        <Menu.MenuSeparator key="anti-sleepcall-separator" />,
        <Menu.MenuItem
            id="anti-sleepcall-slider"
            label={remainingSeconds > 0
                ? `AntiSleepcall: Regler le timer (${Math.ceil(remainingSeconds / 60)} min restantes)`
                : "AntiSleepcall: Regler le timer (minutes)"}
            action={openSleepTimerModal}
        />,
        <Menu.MenuItem
            id="anti-sleepcall-cancel"
            label={remainingSeconds > 0
                ? `AntiSleepcall: Annuler le timer (${remainingSeconds}s restantes)`
                : "AntiSleepcall: Annuler le timer"}
            action={() => clearSchedule(true)}
            disabled={!disconnectTimeout}
        />
    );
};

export default definePlugin({
    name: "AntiSleepcall",
    description: "Planifie une deconnexion d'un appel prive depuis le menu contextuel utilisateur",
    authors: [{
        name: "Bash",
        id: 1327483363518582784n
    }],

    contextMenus: {
        "user-context": UserContextMenuPatch
    },

    stop() {
        clearSchedule();
    }
});
