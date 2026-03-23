# Prompt — Plugin Vencord : FriendSync

Tu es un développeur expert en **plugins Vencord** (le mod client Discord open-source basé sur React/TypeScript). Je veux que tu crées de zéro un plugin complet nommé **FriendSync**.

---

## Objectif du plugin

Permettre à un utilisateur possédant **plusieurs comptes Discord** de **synchroniser visuellement sa liste d'amis entre ses comptes**, sans jamais envoyer de demande d'amis automatiquement. Le plugin est 100% passif en lecture. Il compare les amis du compte A avec les amis du compte B et affiche les différences.

---

## Comportement attendu

1. Quand l'utilisateur est connecté sur le **compte A**, le plugin prend un **snapshot** (instantané) de sa liste d'amis et le sauvegarde localement.
2. Quand l'utilisateur switche sur le **compte B**, le plugin compare automatiquement la liste du compte B avec le snapshot du compte A.
3. Le plugin affiche les différences dans un **panneau dédié** et via des **toasts de notification**.
4. Aucune demande d'amis n'est jamais envoyée. Aucun appel à l'API REST de Discord n'est fait en écriture.

---

## Structure des fichiers à créer

```
src/userplugins/friendSync/
├── index.ts
├── extractor.ts
├── diff.ts
├── storage.ts
├── watcher.ts
├── settings.ts
└── ui/
    ├── NotifToast.tsx
    └── DiffPanel.tsx
```

---

## Détail de chaque fichier

### `index.ts`
Point d'entrée du plugin Vencord.

```ts
import definePlugin, { OptionType } from "@utils/types";
import { settings } from "./settings";
import { startWatcher, stopWatcher } from "./watcher";

export default definePlugin({
    name: "FriendSync",
    description: "Synchronise visuellement la liste d'amis entre plusieurs comptes Discord.",
    authors: [{ name: "toi", id: 0n }],
    settings,
    start() {
        startWatcher();
    },
    stop() {
        stopWatcher();
    },
});
```

---

### `settings.ts`
Définition des paramètres configurables du plugin.

```ts
import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    pollInterval: {
        type: OptionType.NUMBER,
        description: "Intervalle de vérification automatique (en minutes)",
        default: 30,
    },
    showToast: {
        type: OptionType.BOOLEAN,
        description: "Afficher une notification toast lors d'un changement détecté",
        default: true,
    },
    autoSnapshot: {
        type: OptionType.BOOLEAN,
        description: "Prendre automatiquement un snapshot à chaque connexion",
        default: true,
    },
});
```

---

### `extractor.ts`
Lecture de la liste d'amis via les stores internes Discord.

```ts
import { RelationshipStore, UserStore } from "@webpack/common";

export interface FriendEntry {
    userId: string;
    username: string;
    globalName: string | null;
}

export function extractFriends(): FriendEntry[] {
    const ids: string[] = RelationshipStore.getFriendIDs();
    return ids.map(id => {
        const user = UserStore.getUser(id);
        return {
            userId: id,
            username: user?.username ?? "Unknown",
            globalName: user?.globalName ?? null,
        };
    });
}

export function getCurrentUserId(): string {
    return UserStore.getCurrentUser()?.id ?? "";
}
```

---

### `storage.ts`
Sauvegarde locale des snapshots par userId.

```ts
import { DataStore } from "@api/DataStore";
import { FriendEntry } from "./extractor";

const KEY_PREFIX = "FriendSync_snapshot_";

export async function saveSnapshot(userId: string, friends: FriendEntry[]): Promise<void> {
    const data = {
        timestamp: Date.now(),
        friends,
    };
    await DataStore.set(KEY_PREFIX + userId, JSON.stringify(data));
}

export async function loadSnapshot(userId: string): Promise<{ timestamp: number; friends: FriendEntry[] } | null> {
    const raw = await DataStore.get(KEY_PREFIX + userId);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export async function listSnapshotUserIds(): Promise<string[]> {
    const keys: string[] = await DataStore.keys();
    return keys
        .filter(k => k.startsWith(KEY_PREFIX))
        .map(k => k.replace(KEY_PREFIX, ""));
}
```

---

### `diff.ts`
Algorithme de comparaison entre deux listes d'amis.

```ts
import { FriendEntry } from "./extractor";

export interface DiffResult {
    onlyInA: FriendEntry[];   // amis sur A, absents de B
    onlyInB: FriendEntry[];   // amis sur B, absents de A
    common: FriendEntry[];    // présents sur les deux
}

export function diffFriends(listA: FriendEntry[], listB: FriendEntry[]): DiffResult {
    const setA = new Set(listA.map(f => f.userId));
    const setB = new Set(listB.map(f => f.userId));

    return {
        onlyInA: listA.filter(f => !setB.has(f.userId)),
        onlyInB: listB.filter(f => !setA.has(f.userId)),
        common:  listA.filter(f => setB.has(f.userId)),
    };
}
```

---

### `watcher.ts`
Détection du changement de compte et déclenchement automatique du diff.

```ts
import { UserStore } from "@webpack/common";
import { settings } from "./settings";
import { extractFriends, getCurrentUserId } from "./extractor";
import { saveSnapshot, loadSnapshot, listSnapshotUserIds } from "./storage";
import { diffFriends } from "./diff";
import { showDiffToast } from "./ui/NotifToast";

let lastUserId: string | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;

async function onAccountChange() {
    const currentId = getCurrentUserId();
    if (!currentId || currentId === lastUserId) return;
    lastUserId = currentId;

    const currentFriends = extractFriends();

    // Sauvegarder le snapshot du compte courant si option activée
    if (settings.store.autoSnapshot) {
        await saveSnapshot(currentId, currentFriends);
    }

    // Chercher un snapshot d'un autre compte pour comparer
    const otherIds = (await listSnapshotUserIds()).filter(id => id !== currentId);
    if (otherIds.length === 0) return;

    for (const otherId of otherIds) {
        const snap = await loadSnapshot(otherId);
        if (!snap) continue;

        const result = diffFriends(snap.friends, currentFriends);
        if (settings.store.showToast) {
            showDiffToast(otherId, currentId, result);
        }
    }
}

export function startWatcher() {
    UserStore.addChangeListener(onAccountChange);
    onAccountChange(); // lancer au démarrage

    const minutes = settings.store.pollInterval;
    intervalId = setInterval(onAccountChange, minutes * 60 * 1000);
}

export function stopWatcher() {
    UserStore.removeChangeListener(onAccountChange);
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
}
```

---

### `ui/NotifToast.tsx`
Toast de notification affiché quand un diff est détecté.

```tsx
import { showNotification } from "@api/Notifications";
import { DiffResult } from "../diff";

export function showDiffToast(accountAId: string, accountBId: string, diff: DiffResult) {
    const added = diff.onlyInA.length;
    const missing = diff.onlyInB.length;

    if (added === 0 && missing === 0) return;

    showNotification({
        title: "FriendSync — Différences détectées",
        body: `${added} ami(s) à ajouter · ${missing} ami(s) à retirer · ${diff.common.length} en commun`,
        onClick: () => {
            // Ouvrir le DiffPanel dans les paramètres du plugin
        },
    });
}
```

---

### `ui/DiffPanel.tsx`
Panneau visuel affichant le diff complet, à intégrer dans les Settings du plugin.

```tsx
import React, { useEffect, useState } from "react";
import { extractFriends, getCurrentUserId } from "../extractor";
import { loadSnapshot, listSnapshotUserIds } from "../storage";
import { diffFriends, DiffResult } from "../diff";
import { Forms, Button } from "@webpack/common";

export function DiffPanel() {
    const [diff, setDiff] = useState<DiffResult | null>(null);
    const [otherAccountId, setOtherAccountId] = useState<string | null>(null);

    async function runDiff() {
        const currentId = getCurrentUserId();
        const currentFriends = extractFriends();
        const otherIds = (await listSnapshotUserIds()).filter(id => id !== currentId);
        if (otherIds.length === 0) return;

        const snap = await loadSnapshot(otherIds[0]);
        if (!snap) return;

        setOtherAccountId(otherIds[0]);
        setDiff(diffFriends(snap.friends, currentFriends));
    }

    useEffect(() => { runDiff(); }, []);

    return (
        <div style={{ padding: "16px" }}>
            <Forms.FormTitle>Comparaison des amis</Forms.FormTitle>
            <Button onClick={runDiff} style={{ marginBottom: "12px" }}>
                Actualiser
            </Button>

            {diff ? (
                <div>
                    <section>
                        <Forms.FormTitle tag="h5" style={{ color: "var(--status-danger)" }}>
                            Absents sur ce compte ({diff.onlyInA.length})
                        </Forms.FormTitle>
                        {diff.onlyInA.map(f => (
                            <div key={f.userId} style={{ padding: "4px 0", color: "var(--text-muted)" }}>
                                {f.globalName ?? f.username} ({f.userId})
                            </div>
                        ))}
                    </section>

                    <section style={{ marginTop: "12px" }}>
                        <Forms.FormTitle tag="h5" style={{ color: "var(--status-positive)" }}>
                            En commun ({diff.common.length})
                        </Forms.FormTitle>
                        {diff.common.map(f => (
                            <div key={f.userId} style={{ padding: "4px 0" }}>
                                {f.globalName ?? f.username}
                            </div>
                        ))}
                    </section>
                </div>
            ) : (
                <Forms.FormText>Aucun snapshot d'un autre compte trouvé. Connecte-toi d'abord sur l'autre compte.</Forms.FormText>
            )}
        </div>
    );
}
```

---

## Contraintes importantes à respecter

- **Jamais d'appel `fetch` ou `XMLHttpRequest` vers l'API Discord** en écriture (pas de POST/PUT/DELETE).
- Utiliser **uniquement** `RelationshipStore`, `UserStore`, `DataStore` — pas d'accès direct à `window.__SENTRY__` ou aux modules webpack non typés.
- Tous les fichiers doivent être en **TypeScript strict** avec types explicites.
- Les composants React doivent utiliser les composants de `@webpack/common` (Forms, Button, etc.) pour s'intégrer visuellement dans l'UI Discord.
- Le plugin doit être compatible avec la **dernière version de Vencord** (structure `src/plugins/`).
- Ajouter les imports manquants si nécessaire en suivant les conventions du dépôt Vencord officiel.

---

## Résultat attendu

Génère **tous les fichiers listés** avec leur contenu complet, prêts à être placés dans `src/plugins/friendSync/`. Le code doit compiler sans erreurs avec le setup TypeScript de Vencord.
