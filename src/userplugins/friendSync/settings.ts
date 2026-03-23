/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    importExportOnly: {
        type: OptionType.BOOLEAN,
        description: "Mode import/export uniquement (aucune synchro auto avec le compte connecte)",
        default: true
    },
    injectFriendsCategory: {
        type: OptionType.BOOLEAN,
        description: "Injecter une categorie visuelle dans la section Amis Discord",
        default: true
    },
    friendsCategoryLabel: {
        type: OptionType.STRING,
        description: "Nom de la categorie (ex: DC)",
        default: "DC"
    },
    friendsCategoryUseDiffName: {
        type: OptionType.BOOLEAN,
        description: "Ajouter l'identifiant du compte source dans le nom de la categorie",
        default: true
    },
    previewLimit: {
        type: OptionType.NUMBER,
        description: "Nombre max d'amis affiches par section (evite les freezes)",
        default: 30
    },
    debugLogs: {
        type: OptionType.BOOLEAN,
        description: "Activer les logs debug FriendSync dans la console",
        default: true
    }
});
