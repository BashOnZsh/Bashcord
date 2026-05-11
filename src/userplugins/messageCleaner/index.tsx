/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, GuildStore, Menu, RestAPI, UserStore } from "@webpack/common";
import { Channel, Message, Guild } from "discord-types/general";
function flattenGuildChannels(container: any): any[] {
    if (!container) return [];
    if (Array.isArray(container)) return container;

    if (Array.isArray(container.SELECTABLE)) {
        return container.SELECTABLE.map((entry: any) => entry?.channel ?? entry).filter(Boolean);
    }

    if (Array.isArray(container.channels)) {
        return container.channels.map((entry: any) => entry?.channel ?? entry).filter(Boolean);
    }

    if (typeof container === "object") {
        return Object.values(container).map((entry: any) => entry?.channel ?? entry).filter(Boolean);
    }

    return [];
}

function getGuildChannels(guildId: string): any[] {
    const cs: any = ChannelStore;

    if (typeof cs.getChannelIds === "function") {
        const ids = cs.getChannelIds(guildId);
        if (Array.isArray(ids)) {
            return ids.map((id: string) => ChannelStore.getChannel(id)).filter(Boolean);
        }
    }

    if (typeof cs.getMutableGuildChannels === "function") {
        return flattenGuildChannels(cs.getMutableGuildChannels(guildId));
    }

    if (typeof cs.getGuildChannels === "function") {
        return flattenGuildChannels(cs.getGuildChannels(guildId));
    }

    if (typeof cs.getAllChannels === "function") {
        const all = cs.getAllChannels();
        return flattenGuildChannels(all).filter((ch: any) => ch.guild_id === guildId);
    }

    if (cs.channels) {
        return flattenGuildChannels(cs.channels).filter((ch: any) => ch.guild_id === guildId);
    }

    log(`Impossible de récupérer la liste des salons. Méthodes dispo: ${Object.keys(cs).join(", ")}`, "error");
    return [];
}

// Fonction pour nettoyer tous les salons textuels d'un serveur
async function cleanGuild(guildId: string) {
    if (isCleaningInProgress) {
        log("Un nettoyage est déjà en cours", "warn");
        return;
    }
    const guild: Guild | undefined = GuildStore.getGuild(guildId);
    if (!guild) {
        log("Serveur introuvable", "error");
        return;
    }
    isCleaningInProgress = true;
    shouldStopCleaning = false;
    cleaningStats = {
        total: 0,
        deleted: 0,
        failed: 0,
        skipped: 0,
        startTime: Date.now()
    };

    try {
        const currentUserId = UserStore.getCurrentUser()?.id;
        if (!currentUserId) {
            log("Impossible d'obtenir l'ID de l'utilisateur actuel", "error");
            return;
        }

        log(`🧹 Nettoyage du serveur (1 seule requete de recherche): ${guild.name}`);
        const messages = await getGuildMessagesByAuthorOnce(guildId, currentUserId);

        if (messages.length === 0) {
            log("Aucun message trouve par la recherche serveur", "warn");
            return;
        }

        const validMessages = messages.filter(msg => canDeleteMessage(msg, currentUserId));
        cleaningStats.total = validMessages.length;

        if (validMessages.length === 0) {
            log("Aucun message supprimable trouve par la recherche serveur", "warn");
            return;
        }

        log(`🧹 Suppression de ${validMessages.length} message(s) trouves par recherche serveur`);
        let processed = 0;
        for (const message of validMessages) {
            if (shouldStopCleaning) break;

            const success = await deleteMessage(message.channel_id, message.id);
            if (success) {
                cleaningStats.deleted++;
            } else {
                cleaningStats.failed++;
            }

            processed++;
            if (settings.store.delayBetweenDeletes > 0) {
                await sleep(settings.store.delayBetweenDeletes);
            }
            if (processed % 10 === 0) {
                updateProgress();
            }
        }

        cleaningStats.skipped += messages.length - validMessages.length;
        log(`✅ Nettoyage du serveur terminé : ${guild.name}`);
    } finally {
        isCleaningInProgress = false;
    }
}
// Patch du menu contextuel des serveurs
const GuildContextMenuPatch: NavContextMenuPatchCallback = (children, ctx: { guild?: Guild; } = {}) => {
    const { guild } = ctx;
    if (!guild) return;

    const group = findGroupChildrenByChildId("guild-header", children) ?? children;

    if (group) {
        const menuItems = [<Menu.MenuSeparator key="separator-guild" />];

        if (isCleaningInProgress) {
            menuItems.push(
                <Menu.MenuItem
                    key="cleaning-status-guild"
                    id="vc-cleaning-status-guild"
                    label={`🔄 Nettoyage en cours (serveur)`}
                    color="brand"
                    disabled={true}
                />
            );
        } else {
            menuItems.push(
                <Menu.MenuItem
                    key="clean-guild-messages"
                    id="vc-clean-guild-messages"
                    label="🧹 Nettoyer tous les messages du serveur"
                    color="danger"
                    action={() => cleanGuild(guild.id)}
                />
            );
        }
        group.push(...menuItems);
    }
};

const settings = definePluginSettings({
    delayBetweenDeletes: {
        type: OptionType.SLIDER,
        description: "Délai entre chaque suppression (ms) - pour éviter le rate limit",
        default: 1000,
        markers: [100, 500, 1000, 2000, 5000],
        minValue: 100,
        maxValue: 10000,
        stickToMarkers: false
    },
    batchSize: {
        type: OptionType.SLIDER,
        description: "Nombre de messages à traiter par batch",
        default: 50,
        markers: [10, 25, 50, 100],
        minValue: 1,
        maxValue: 100,
        stickToMarkers: false
    },
    showProgress: {
        type: OptionType.BOOLEAN,
        description: "Afficher la progression en temps réel",
        default: true
    },
    debugMode: {
        type: OptionType.BOOLEAN,
        description: "Mode débogage (logs détaillés)",
        default: false
    },
    skipSystemMessages: {
        type: OptionType.BOOLEAN,
        description: "Ignorer les messages système (rejoindre/quitter, etc.)",
        default: true
    },
    skipReplies: {
        type: OptionType.BOOLEAN,
        description: "Ignorer les réponses aux messages",
        default: false
    },
    maxAge: {
        type: OptionType.SLIDER,
        description: "Age maximum des messages à supprimer (jours, 0 = pas de limite)",
        default: 0,
        markers: [0, 1, 7, 30, 90],
        minValue: 0,
        maxValue: 365,
        stickToMarkers: false
    }
});

// Variables globales pour le contrôle
let isCleaningInProgress = false;
let shouldStopCleaning = false;
let cleaningStats = {
    total: 0,
    deleted: 0,
    failed: 0,
    skipped: 0,
    startTime: 0
};

// Fonction de log avec préfixe
function log(message: string, level: "info" | "warn" | "error" = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[MessageCleaner ${timestamp}]`;

    switch (level) {
        case "warn":
            console.warn(prefix, message);
            break;
        case "error":
            console.error(prefix, message);
            break;
        default:
            console.log(prefix, message);
    }
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Log de débogage
function debugLog(message: string) {
    if (settings.store.debugMode) {
        log(`🔍 ${message}`, "info");
    }
}

// Fonction pour vérifier si un message peut être supprimé
function canDeleteMessage(message: Message, currentUserId: string): boolean {
    try {
        // Afficher TOUS les détails du message pour debug
        debugLog(`[VÉRIF] Message ${message.id}:`);
        debugLog(`  - type: ${message.type} (19=REPLY, 0=DEFAULT)`);
        debugLog(`  - author.id: ${message.author?.id}`);
        debugLog(`  - messageReference: ${!!message.messageReference}`);
        debugLog(`  - message_reference: ${!!(message as any).message_reference}`);
        debugLog(`  - Toutes les clés: ${Object.keys(message).join(', ')}`);

        // TOUJOURS: Vérifier que c'est notre propre message (PAS D'OPTION)
        if (message.author?.id !== currentUserId) {
            debugLog(`  ❌ Pas votre message (${message.author?.id} != ${currentUserId})`);
            return false;
        }

        // Messages système (SAUF type 19 qui est REPLY)
        if (settings.store.skipSystemMessages && message.type !== 0 && message.type !== 19) {
            debugLog(`  ❌ Message système (type ${message.type})`);
            return false;
        }

        // Détection des réponses - Type 19 OU présence de messageReference
        const isReply = message.type === 19 || !!message.messageReference || !!(message as any).message_reference;
        if (isReply) {
            debugLog(`  ⚠️ DÉTECTÉ COMME RÉPONSE (type=${message.type}, ref=${!!message.messageReference})`);
            if (settings.store.skipReplies) {
                debugLog(`  ❌ Ignoré: skipReplies=true`);
                return false;
            } else {
                debugLog(`  ✅ Sera supprimé: skipReplies=false`);
            }
        }

        // Age maximum
        if (settings.store.maxAge > 0) {
            let messageTime: number;

            // Gérer différents formats de timestamp
            if (typeof message.timestamp === 'string') {
                messageTime = new Date(message.timestamp).getTime();
            } else if (message.timestamp && typeof message.timestamp === 'object' && 'toISOString' in message.timestamp) {
                messageTime = new Date(message.timestamp.toISOString()).getTime();
            } else if (typeof message.timestamp === 'number') {
                messageTime = message.timestamp;
            } else {
                debugLog(`  ❌ Timestamp invalide`);
                return false;
            }

            // Vérifier si le timestamp est valide
            if (isNaN(messageTime) || messageTime <= 0) {
                debugLog(`  ❌ Timestamp invalide (${message.timestamp})`);
                return false;
            }

            const messageAge = Date.now() - messageTime;
            const maxAgeMs = settings.store.maxAge * 24 * 60 * 60 * 1000;

            if (messageAge > maxAgeMs) {
                debugLog(`  ❌ Trop ancien (${Math.round(messageAge / (24 * 60 * 60 * 1000))} jours)`);
                return false;
            }
        }

        debugLog(`  ✅ PEUT ÊTRE SUPPRIMÉ`);
        return true;
    } catch (error) {
        debugLog(`  ❌ ERREUR: ${error}`);
        return false;
    }
}

// Fonction pour supprimer un message
async function deleteMessage(channelId: string, messageId: string): Promise<boolean> {
    try {
        debugLog(`Tentative de suppression du message ${messageId} dans le canal ${channelId}`);

        const response = await RestAPI.del({
            url: `/channels/${channelId}/messages/${messageId}`
        });

        debugLog(`✅ Message ${messageId} supprimé avec succès`);
        return true;
    } catch (error: any) {
        const errorMessage = error?.message || error?.toString() || 'Erreur inconnue';
        const statusCode = error?.status || error?.statusCode || 'N/A';

        debugLog(`❌ Erreur lors de la suppression du message ${messageId}: ${errorMessage} (Status: ${statusCode})`);

        // Log des erreurs spécifiques
        if (statusCode === 403) {
            debugLog(`❌ Permission refusée pour supprimer le message ${messageId}`);
        } else if (statusCode === 404) {
            debugLog(`❌ Message ${messageId} introuvable (déjà supprimé?)`);
        } else if (statusCode === 429) {
            debugLog(`❌ Rate limit atteint pour la suppression`);
        }

        return false;
    }
}

// Fonction pour obtenir les messages d'un canal
async function getChannelMessages(channelId: string, before?: string): Promise<Message[]> {
    try {
        const url = before
            ? `/channels/${channelId}/messages?limit=${settings.store.batchSize}&before=${before}`
            : `/channels/${channelId}/messages?limit=${settings.store.batchSize}`;

        debugLog(`Récupération des messages depuis: ${url}`);

        const response = await RestAPI.get({ url });

        if (!response || !response.body) {
            debugLog(`Réponse vide ou invalide pour ${url}`);
            return [];
        }

        const messages = Array.isArray(response.body) ? response.body : [];
        debugLog(`Récupéré ${messages.length} messages depuis le canal ${channelId}`);

        return messages;
    } catch (error: any) {
        const errorMessage = error?.message || error?.toString() || 'Erreur inconnue';
        const statusCode = error?.status || error?.statusCode || 'N/A';

        log(`❌ Erreur lors de la récupération des messages: ${errorMessage} (Status: ${statusCode})`, "error");

        if (statusCode === 403) {
            log(`❌ Permission refusée pour accéder au canal ${channelId}`, "error");
        } else if (statusCode === 404) {
            log(`❌ Canal ${channelId} introuvable`, "error");
        } else if (statusCode === 429) {
            log(`❌ Rate limit atteint pour la récupération des messages`, "error");
        }

        return [];
    }
}

// Récupérer les messages d'un utilisateur dans un serveur (une seule requête)
async function getGuildMessagesByAuthorOnce(guildId: string, userId: string): Promise<Message[]> {
    try {
        const limit = 25;
        const url = `/guilds/${guildId}/messages/search?author_id=${userId}&include_nsfw=true&limit=${limit}`;
        debugLog(`Recherche des messages (1 seule requete): ${url}`);

        const response = await RestAPI.get({ url });
        const body = response?.body;
        const rawMessages = Array.isArray(body?.messages) ? body.messages : [];

        const flattened: Message[] = [];
        for (const entry of rawMessages) {
            if (Array.isArray(entry) && entry[0]) {
                flattened.push(entry[0]);
            } else if (entry) {
                flattened.push(entry);
            }
        }

        debugLog(`Recherche: ${flattened.length} message(s) recu(s)`);
        return flattened;
    } catch (error: any) {
        const errorMessage = error?.message || error?.toString() || "Erreur inconnue";
        const statusCode = error?.status || error?.statusCode || "N/A";

        log(`❌ Erreur lors de la recherche des messages serveur: ${errorMessage} (Status: ${statusCode})`, "error");
        return [];
    }
}

// Fonction pour afficher la progression
function updateProgress() {
    if (!settings.store.showProgress) return;

    const { total, deleted, failed, skipped, startTime } = cleaningStats;
    const processed = deleted + failed + skipped;
    const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;

    // Calculer le temps écoulé et estimé
    const elapsed = Date.now() - startTime;
    const elapsedStr = elapsed < 60000
        ? `${Math.round(elapsed / 1000)}s`
        : `${Math.round(elapsed / 60000)}min`;

    let etaStr = "";
    if (processed > 0 && percentage > 0) {
        const remaining = total - processed;
        const rate = processed / (elapsed / 1000); // messages par seconde
        const eta = remaining / rate;
        etaStr = eta < 60
            ? ` (~${Math.round(eta)}s restantes)`
            : ` (~${Math.round(eta / 60)}min restantes)`;
    }
}

// Fonction principale de nettoyage
async function cleanChannel(channelId: string, options?: { skipSessionControl?: boolean }) {
    if (!options?.skipSessionControl && isCleaningInProgress) {
        log("Un nettoyage est déjà en cours", "warn");
        return;
    }

    try {
        const channel = ChannelStore.getChannel(channelId);
        const currentUserId = UserStore.getCurrentUser()?.id;

        if (!channel) {
            log("Canal introuvable", "error");
            return;
        }

        if (!currentUserId) {
            log("Impossible d'obtenir l'ID de l'utilisateur actuel", "error");
            return;
        }

        const channelName = channel.name || channel.recipients?.map((id: string) => {
            const user = UserStore.getUser(id);
            return user?.username || "Utilisateur inconnu";
        }).join(", ") || "Canal privé";

        // Analyse rapide du canal
        log(`🔍 Analyse du canal "${channelName}"...`);
        log(`⚙️ Configuration: délai ${settings.store.delayBetweenDeletes}ms, batch ${settings.store.batchSize}`);

        // Initialiser les statistiques
        if (!options?.skipSessionControl) {
            isCleaningInProgress = true;
            shouldStopCleaning = false;
        }
        cleaningStats = {
            total: 0,
            deleted: 0,
            failed: 0,
            skipped: 0,
            startTime: Date.now()
        };

        log(`🧹 Début du nettoyage de "${channelName}"`);

        let lastMessageId: string | undefined;
        let totalProcessed = 0;
        let emptyValidBatches = 0;
        const maxEmptyValidBatches = 1;

        // Boucle principale de nettoyage
        while (!shouldStopCleaning) {
            try {
                const messages = await getChannelMessages(channelId, lastMessageId);

                if (messages.length === 0) {
                    log("Plus de messages à traiter");
                    break;
                }

                debugLog(`Traitement de ${messages.length} messages...`);

                // Afficher un aperçu des messages trouvés
                for (let i = 0; i < Math.min(3, messages.length); i++) {
                    const msg = messages[i];
                    debugLog(`  [${i}] ID: ${msg.id}, Type: ${msg.type}, Author: ${msg.author?.id}, Ref: ${(msg as any).messageReference ? 'OUI' : 'NON'}`);
                }

                const validMessages = messages.filter(msg => canDeleteMessage(msg, currentUserId));
                debugLog(`${validMessages.length} messages valides sur ${messages.length}`);

                if (validMessages.length === 0) {
                    // Si aucun message valide dans ce batch, passer au suivant
                    lastMessageId = messages[messages.length - 1].id;
                    cleaningStats.skipped += messages.length;
                    emptyValidBatches++;
                    debugLog(`Aucun message valide dans ce batch, passage au suivant`);
                    if (emptyValidBatches >= maxEmptyValidBatches) {
                        log("Aucun message supprimable trouve dans le dernier batch, arret pour limiter les requetes", "warn");
                        break;
                    }
                    await sleep(400);
                    continue;
                }

                emptyValidBatches = 0;

                // Supprimer les messages un par un
                for (const message of validMessages) {
                    if (shouldStopCleaning) {
                        log("Arrêt demandé par l'utilisateur");
                        break;
                    }

                    const success = await deleteMessage(channelId, message.id);

                    if (success) {
                        cleaningStats.deleted++;
                        debugLog(`✅ Message ${message.id} supprimé`);
                    } else {
                        cleaningStats.failed++;
                        debugLog(`❌ Échec de suppression du message ${message.id}`);
                    }

                    totalProcessed++;

                    // Délai anti-rate-limit
                    if (settings.store.delayBetweenDeletes > 0) {
                        await new Promise(resolve => setTimeout(resolve, settings.store.delayBetweenDeletes));
                    }

                    // Mise à jour de la progression tous les 10 messages
                    if (totalProcessed % 10 === 0) {
                        updateProgress();
                    }
                }

                // Messages non valides comptés comme ignorés
                cleaningStats.skipped += (messages.length - validMessages.length);

                lastMessageId = messages[messages.length - 1].id;

                await sleep(400);

                // Si on a traité moins de messages que la taille du batch, on a fini
                if (messages.length < settings.store.batchSize) {
                    debugLog(`Batch incomplet (${messages.length}/${settings.store.batchSize}), fin du traitement`);
                    break;
                }

            } catch (error: any) {
                const errorMessage = error?.message || error?.toString() || 'Erreur inconnue';
                const statusCode = error?.status || error?.statusCode || 'N/A';

                log(`❌ Erreur dans la boucle de nettoyage: ${errorMessage} (Status: ${statusCode})`, "error");
                cleaningStats.failed++;

                // Gestion spécifique des erreurs de rate limiting
                if (statusCode === 429) {
                    log("Rate limit atteint, pause prolongée...", "warn");
                    await new Promise(resolve => setTimeout(resolve, 30000)); // 30 secondes
                } else {
                    // Attendre un peu avant de continuer en cas d'erreur normale
                    await new Promise(resolve => setTimeout(resolve, 5000)); // 5 secondes
                }

                // Si trop d'erreurs consécutives, arrêter
                if (cleaningStats.failed > 15) {
                    log("Trop d'erreurs consécutives, arrêt du nettoyage", "error");
                    break;
                }
            }
        }

        // Nettoyage terminé
        if (!options?.skipSessionControl) {
            isCleaningInProgress = false;
        }

        const { deleted, failed, skipped, startTime } = cleaningStats;
        const finalTotal = deleted + failed + skipped;
        const totalTime = Date.now() - startTime;
        const totalTimeStr = totalTime < 60000
            ? `${Math.round(totalTime / 1000)} secondes`
            : `${Math.round(totalTime / 60000)} min ${Math.round((totalTime % 60000) / 1000)}s`;

        const avgTimePerMessage = deleted > 0 ? Math.round(totalTime / deleted) : 0;
        const successRate = finalTotal > 0 ? Math.round((deleted / finalTotal) * 100) : 0;

        log(`✅ Nettoyage terminé:
• Messages traités: ${finalTotal}
• Supprimés: ${deleted}
• Échecs: ${failed}
• Ignorés: ${skipped}
• Temps total: ${totalTimeStr}
• Taux de succès: ${successRate}%
• Temps moyen/message: ${avgTimePerMessage}ms`);

    } catch (error) {
        if (!options?.skipSessionControl) {
            isCleaningInProgress = false;
        }
        log(`❌ Erreur globale lors du nettoyage: ${error}`, "error");
    }
}

// Fonction pour arrêter le nettoyage
function stopCleaning() {
    if (isCleaningInProgress) {
        shouldStopCleaning = true;
        log("⏹️ Arrêt du nettoyage demandé");
    }
}

// Patch du menu contextuel des canaux
const ChannelContextMenuPatch: NavContextMenuPatchCallback = (children, ctx: { channel?: Channel; } = {}) => {
    const { channel } = ctx;
    if (!channel) return;

    const group = findGroupChildrenByChildId("mark-channel-read", children) ?? children;

    if (group) {
        const menuItems = [<Menu.MenuSeparator key="separator" />];

        if (isCleaningInProgress) {
            // Afficher les stats du nettoyage en cours
            const { total, deleted, failed, skipped, startTime } = cleaningStats;
            const processed = deleted + failed + skipped;
            const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;
            const elapsed = Math.round((Date.now() - startTime) / 1000);

            menuItems.push(
                <Menu.MenuItem
                    key="cleaning-status"
                    id="vc-cleaning-status"
                    label={`🔄 Nettoyage en cours: ${percentage}% (${processed}/${total})`}
                    color="brand"
                    disabled={true}
                />,
                <Menu.MenuItem
                    key="stop-cleaning"
                    id="vc-stop-cleaning"
                    label="⏹️ Arrêter le nettoyage"
                    color="danger"
                    action={stopCleaning}
                />
            );
        } else {
            // Option de nettoyage normal
            menuItems.push(
                <Menu.MenuItem
                    key="clean-messages"
                    id="vc-clean-messages"
                    label="🧹 Nettoyer les messages"
                    color="danger"
                    action={() => cleanChannel(channel.id)}
                />
            );
        }

        group.push(...menuItems);
    }
};

export default definePlugin({
    name: "MessageCleaner",
    description: "Nettoie tous les messages d'un canal avec gestion intelligente du rate limiting, statistiques temps réel et confirmation sécurisée",
    authors: [{
        name: "Bash",
        id: 1327483363518582784n
    }],
    dependencies: ["ContextMenuAPI"],
    settings,

    contextMenus: {
        "channel-context": ChannelContextMenuPatch,
        "gdm-context": ChannelContextMenuPatch,
        "user-context": ChannelContextMenuPatch,
        "guild-context": GuildContextMenuPatch
    },

    start() {
        log("🚀 Plugin MessageCleaner démarré");

        // Test des dépendances
        log("🔍 Test des dépendances:");
        log(`- RestAPI: ${typeof RestAPI}`);
        log(`- ChannelStore: ${typeof ChannelStore}`);
        log(`- UserStore: ${typeof UserStore}`);
        log(`- Menu: ${typeof Menu}`);

        debugLog(`Configuration:
• Délai: ${settings.store.delayBetweenDeletes}ms
• Batch: ${settings.store.batchSize}
• Ignorer réponses: ${settings.store.skipReplies}
• Age max: ${settings.store.maxAge} jours
• Mode debug: ${settings.store.debugMode}`);
    },

    stop() {
        log("🛑 Plugin MessageCleaner arrêté");

        // Arrêter le nettoyage en cours
        if (isCleaningInProgress) {
            shouldStopCleaning = true;
        }
    }
});
