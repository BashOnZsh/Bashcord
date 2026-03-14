/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { DataStore } from "@api/index";
import { disableStyle, enableStyle } from "@api/Styles";
import { Devs } from "@utils/constants";
import { ModalProps, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Menu, Text, TextInput } from "@webpack/common";
import { User } from "discord-types/general";

import style from "./style.css";
import { ClientUser, userChange } from "./types";

// Helper function to convert file to data URL
function fileToDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Get UserStore for modifying user objects
const UserStore = findByPropsLazy("getCurrentUser", "getUser");

let changes: { [key: string]: userChange; } = {};
let originalGetUser: ((userId: string) => unknown) | undefined;
let originalGetCurrentUser: (() => unknown) | undefined;

// Function to apply saved changes to a user object
function applyChanges(user: ClientUser | null): ClientUser | null {
    if (!user || !changes[user.id]) return user;

    const data = changes[user.id];

    if (data.name) user.globalName = data.name;
    if (data.url) user.avatar = data.url;
    if (data.removeIcon) user.avatar = undefined;
    if (data.banner) (user as any).banner = data.banner;
    if (data.removeBanner) (user as any).banner = null;
    if (data.color1) (user as any).accentColor = parseInt(data.color1.replace("#", ""), 16);

    return user;
}

const contextMenuPatch: NavContextMenuPatchCallback = (children: any[], { user }: { user: User; }) => {
    if (!user) return;
    children.push(
        <Menu.MenuItem
            id="vc-edit-user"
            label="Éditer l'utilisateur"
            action={() => openModal((props: any) => editUserPane(user as unknown as ClientUser, props))}
            icon="edit"
        />
    );
};
function editUserPane(user: ClientUser, props: ModalProps) {
    if (!user) return null;

    // Initialize user changes if not exists
    if (!changes[user.id]) {
        changes[user.id] = {};
    }

    const data = changes[user.id] || {};
    let isSaving = false;

    const handleSave = async () => {
        if (isSaving) return;
        isSaving = true;

        try {
            // Save changes to persistent storage
            await DataStore.set("editUsers", changes);

            // Show success message
            const btn = document.querySelector(".edit-user-btn-save") as HTMLButtonElement;
            if (btn) {
                const oldText = btn.textContent;
                btn.textContent = "✅ Enregistré!";
                btn.disabled = true;
                setTimeout(() => {
                    btn.textContent = oldText;
                    btn.disabled = false;
                }, 2000);
            }

            setTimeout(() => props.onClose?.(), 500);
        } finally {
            isSaving = false;
        }
    };

    const handleReset = () => {
        delete changes[user.id];
        DataStore.set("editUsers", changes);
        props.onClose?.();
    };

    return (
        <ModalRoot {...props} className="edit-user-modal">
            {/* Banner Header */}
            <div className="edit-user-banner-container">
                {data.banner ? (
                    <img src={data.banner} alt="Banner" />
                ) : (
                    <div className="edit-user-banner-overlay">Cliquez pour modifier la bannière</div>
                )}
            </div>

            {/* User Info Header */}
            <div className="edit-user-header">
                <div className="edit-user-avatar-container">
                    {data.url ? (
                        <img src={data.url} alt="Avatar" className="edit-user-avatar-display" />
                    ) : user.avatar ? (
                        <img src={`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}`} alt="Avatar" className="edit-user-avatar-display" />
                    ) : (
                        <div className="edit-user-avatar-placeholder">👤</div>
                    )}
                </div>
                <div className="edit-user-header-info">
                    <h2>{data.name || user.globalName || user.username}</h2>
                    <p>@{user.username}</p>
                    <p style={{ fontSize: "12px", marginTop: "4px" }}>ID: {user.id}</p>
                </div>
            </div>

            <div className="edit-user-content">
                {/* Profile Section */}
                <div className="edit-user-section">
                    <div className="edit-user-section-title">👤 Profil</div>

                    <div className="edit-user-field">
                        <Text variant="eyebrow" tag="h3">Nom d'affichage</Text>
                        <TextInput
                            defaultValue={data.name || ""}
                            placeholder={user.globalName || user.username}
                            onChange={value => {
                                changes[user.id].name = value || undefined;
                            }}
                        />
                    </div>

                {/* Avatar */}
                <div className="edit-user-field">
                    <Text variant="eyebrow" tag="h3">Avatar</Text>
                    {data.url && <img src={data.url} alt="Avatar preview" className="edit-user-avatar-preview" />}
                    <div className="edit-user-input-group">
                        <TextInput
                            defaultValue={data.url || ""}
                            placeholder="https://... ou coller une URL de données"
                            onChange={value => {
                                changes[user.id].url = value || undefined;
                            }}
                        />
                        <label className="edit-user-file-label">
                            <input
                                type="file"
                                accept="image/*"
                                style={{ display: "none" }}
                                onChange={async e => {
                                    const file = e.currentTarget.files?.[0];
                                    if (file) {
                                        const dataURL = await fileToDataURL(file);
                                        changes[user.id].url = dataURL;
                                        if (e.currentTarget) {
                                            e.currentTarget.value = "";
                                        }
                                    }
                                }}
                            />
                            📁 Charger
                        </label>
                    </div>
                    <label className="edit-user-checkbox-group">
                        <input
                            type="checkbox"
                            checked={data.removeIcon || false}
                            onChange={e => {
                                changes[user.id].removeIcon = e.currentTarget.checked || undefined;
                            }}
                        />
                        Supprimer l'avatar
                    </label>
                </div>

                {/* Banner */}
                <div className="edit-user-field">
                    <Text variant="eyebrow" tag="h3">Bannière</Text>
                    {data.banner && <img src={data.banner} alt="Banner preview" className="edit-user-banner-preview" />}
                    <div className="edit-user-input-group">
                        <TextInput
                            defaultValue={data.banner || ""}
                            placeholder="https://... ou coller une URL de données"
                            onChange={value => {
                                changes[user.id].banner = value || undefined;
                            }}
                        />
                        <label className="edit-user-file-label">
                            <input
                                type="file"
                                accept="image/*"
                                style={{ display: "none" }}
                                onChange={async e => {
                                    const file = e.currentTarget.files?.[0];
                                    if (file) {
                                        const dataURL = await fileToDataURL(file);
                                        changes[user.id].banner = dataURL;
                                        if (e.currentTarget) {
                                            e.currentTarget.value = "";
                                        }
                                    }
                                }}
                            />
                            📁 Charger
                        </label>
                    </div>
                    <label className="edit-user-checkbox-group">
                        <input
                            type="checkbox"
                            checked={data.removeBanner || false}
                            onChange={e => {
                                changes[user.id].removeBanner = e.currentTarget.checked || undefined;
                            }}
                        />
                        Supprimer la bannière
                    </label>
                </div>
                </div>

                {/* Appearance Section */}
                <div className="edit-user-section">
                    <div className="edit-user-section-title">🎨 Apparence</div>

                {/* Name Color */}
                <div className="edit-user-field">
                    <Text variant="eyebrow" tag="h3">Couleur du nom</Text>
                    <div className="edit-user-color-group">
                        <input
                            type="color"
                            defaultValue={data.color1 || "#ffffff"}
                            className="edit-user-color-input"
                            onChange={e => {
                                changes[user.id].color1 = e.currentTarget.value;
                            }}
                        />
                        <TextInput
                            defaultValue={data.color1 || ""}
                            placeholder="#ffffff"
                            onChange={value => {
                                changes[user.id].color1 = value || undefined;
                            }}
                        />
                    </div>
                </div>
                </div>

                {/* Status Section */}
                <div className="edit-user-section">
                    <div className="edit-user-section-title">💬 Statut</div>

                {/* Custom Status */}
                <div className="edit-user-field">
                    <Text variant="eyebrow" tag="h3">Statut personnalisé</Text>
                    <TextInput
                        defaultValue={data.status || ""}
                        placeholder="Définir un statut personnalisé..."
                        onChange={value => {
                            changes[user.id].status = value || undefined;
                        }}
                    />
                    <label className="edit-user-checkbox-group">
                        <input
                            type="checkbox"
                            checked={data.removeStatus || false}
                            onChange={e => {
                                changes[user.id].removeStatus = e.currentTarget.checked || undefined;
                            }}
                        />
                        Supprimer le statut
                    </label>
                </div>
                </div>
            </div>

            <div className="edit-user-buttons">
                <button className="edit-user-btn-save" onClick={handleSave}>✅ Enregistrer</button>
                <button className="edit-user-btn-reset" onClick={handleReset}>🔄 Réinitialiser</button>
            </div>
        </ModalRoot>
    );
}

export default definePlugin({
    name: "Edit Users",
    description: "Permet d'éditer localement les utilisateurs.",
    authors: [Devs.ImLvna],

    patches: [
        // Patch pour modifier les noms affichés partout
        {
            find: "renderPendingApplication",
            replacement: {
                match: /(?<=globalName:)(\w+)/,
                replace: "(arguments[0]?.globalName && $self.getEditedName(arguments[0].id)) || $1"
            },
            predicate: () => true,
            optional: true
        },
        // Patch pour les avatars
        {
            find: '"invalid image size"',
            replacement: {
                match: /(?<=src:)([^,}]+)/,
                replace: "$self.getEditedAvatar(arguments[0]?.id) || $1"
            },
            predicate: () => true,
            optional: true
        }
    ],

    getEditedName(userId: string) {
        if (changes[userId]?.name) {
            return changes[userId].name;
        }
        return null;
    },

    getEditedAvatar(userId: string) {
        if (changes[userId]?.url) {
            return changes[userId].url;
        }
        return null;
    },

    async start() {
        try {
            changes = await DataStore.get("editUsers") || {};
            addContextMenuPatch("user-context", contextMenuPatch);
            if (typeof style === "string") {
                enableStyle(style);
            }

            // Patch UserStore methods to apply changes automatically
            if (UserStore) {
                if (!originalGetUser) {
                    originalGetUser = UserStore.getUser;
                }
                if (!originalGetCurrentUser) {
                    originalGetCurrentUser = UserStore.getCurrentUser;
                }

                UserStore.getUser = function(userId: string) {
                    const user = originalGetUser?.call(this, userId);
                    return applyChanges(user as ClientUser);
                };

                UserStore.getCurrentUser = function() {
                    const user = originalGetCurrentUser?.call(this);
                    return applyChanges(user as ClientUser);
                };
            }
        } catch (error) {
            console.error("[EditUsers] Failed to start:", error);
        }
    },

    async stop() {
        try {
            removeContextMenuPatch("user-context", contextMenuPatch);
            if (typeof style === "string") {
                disableStyle(style);
            }

            if (UserStore) {
                if (originalGetUser) {
                    UserStore.getUser = originalGetUser;
                }
                if (originalGetCurrentUser) {
                    UserStore.getCurrentUser = originalGetCurrentUser;
                }
            }

            await DataStore.set("editUsers", changes);
        } catch (error) {
            console.error("[EditUsers] Failed to stop:", error);
        }
    }
});
