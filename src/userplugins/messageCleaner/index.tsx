/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, Menu, RestAPI, UserStore } from "@webpack/common";
import { Channel, Message } from "discord-types/general";

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Activer le plugin MessageCleaner",
        default: true
    },
    targetChannelId: {
        type: OptionType.STRING,
        description: "ID du canal à nettoyer (laisser vide pour utiliser le menu contextuel)",
        default: ""
    },
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
        default: true
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
async function cleanChannel(channelId: string) {
    if (!settings.store.enabled) {
        log("Plugin désactivé", "warn");
        return;
    }

    if (isCleaningInProgress) {
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

        // Estimation initiale du nombre de messages
        log(`🔍 Analyse du canal "${channelName}"...`);
        let estimatedTotal = 0;
        let lastMessageId: string | undefined;

        // Compter approximativement les messages
        for (let i = 0; i < 10; i++) { // Maximum 10 batches pour l'estimation
            const messages = await getChannelMessages(channelId, lastMessageId);
            if (messages.length === 0) break;

            const validMessages = messages.filter(msg => canDeleteMessage(msg, currentUserId));
            estimatedTotal += validMessages.length;
            lastMessageId = messages[messages.length - 1].id;

            if (messages.length < settings.store.batchSize) break;
        }

        if (estimatedTotal === 0) {
            log("Aucun message à supprimer trouvé", "warn");
            return;
        }


        log(`📊 Estimation: ${estimatedTotal} messages à supprimer`);
        log(`⚙️ Configuration: délai ${settings.store.delayBetweenDeletes}ms, batch ${settings.store.batchSize}`);

        // Initialiser les statistiques
        isCleaningInProgress = true;
        shouldStopCleaning = false;
        cleaningStats = {
            total: estimatedTotal,
            deleted: 0,
            failed: 0,
            skipped: 0,
            startTime: Date.now()
        };

        log(`🧹 Début du nettoyage de "${channelName}" - ${estimatedTotal} message(s) estimé(s)`);

        lastMessageId = undefined;
        let totalProcessed = 0;

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
                    debugLog(`Aucun message valide dans ce batch, passage au suivant`);
                    continue;
                }

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
                const invalidMessages = messages.filter(msg => !canDeleteMessage(msg, currentUserId));
                cleaningStats.skipped += invalidMessages.length;

                lastMessageId = messages[messages.length - 1].id;

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
        isCleaningInProgress = false;

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
        isCleaningInProgress = false;
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
        "user-context": ChannelContextMenuPatch
    },

    start() {
        log("🚀 Plugin MessageCleaner démarré");

        // Test des dépendances
        log("🔍 Test des dépendances:");
        log(`- RestAPI: ${typeof RestAPI}`);
        log(`- ChannelStore: ${typeof ChannelStore}`);
        log(`- UserStore: ${typeof UserStore}`);
        log(`- Menu: ${typeof Menu}`);

        // Si un canal est configuré dans les settings, proposer de le nettoyer
        if (settings.store.targetChannelId.trim()) {
            const channel = ChannelStore.getChannel(settings.store.targetChannelId);
            if (channel) {
                const channelName = channel.name || "Canal privé";
                log(`🎯 Canal cible configuré: "${channelName}" (${settings.store.targetChannelId})`);
            } else {
                log("⚠️ Canal cible configuré mais introuvable", "warn");
            }
        }

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
