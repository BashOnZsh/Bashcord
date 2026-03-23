/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { settings } from "../settings";
import { getLatestSourceFriends, getLatestStatus } from "../watcher";

const TAB_ID = "friendsync-dc-tab";
const PANEL_ID = "friendsync-dc-panel";
const TABLIST_MARKERS = [
    "Online",
    "All",
    "Pending",
    "Blocked",
    "Add Friend",
    "En ligne",
    "Tous",
    "En attente",
    "Bloques",
    "Bloques",
    "Ajouter"
];

const APPLY_THROTTLE_MS = 1200;
const TABLIST_DEBUG_THROTTLE_MS = 8000;

let activeTabList: HTMLElement | null = null;
let tabListClickHandler: ((event: MouseEvent) => void) | null = null;
let customTabActive = false;
let keepCustomTabOpen = false;
let locationChangeHandler: (() => void) | null = null;
let applyTimer: ReturnType<typeof setTimeout> | null = null;
let injectionStarted = false;
let applyingCategory = false;
let lastApplyAt = 0;
let lastTablistDebugSignature = "";
let lastTablistDebugAt = 0;
let lastNoDiffLogAt = 0;
const NO_DIFF_LOG_THROTTLE_MS = 8000;

function debugLog(message: string, ...rest: unknown[]): void {
    if (!settings.store.debugLogs) return;
    console.log("[FriendSync]", message, ...rest);
}

function getCurrentRoute(): string {
    return `${window.location.pathname}${window.location.hash}`;
}

function isFriendsRoute(): boolean {
    const route = getCurrentRoute();
    return route.includes("/channels/@me") || route.includes("/@me");
}

function getCategoryLabel(): string {
    const fallback = (settings.store.friendsCategoryLabel || "DC").trim() || "DC";

    if (!settings.store.friendsCategoryUseDiffName) {
        return fallback;
    }

    const latestSource = getLatestSourceFriends();
    if (!latestSource?.accountId) {
        return fallback;
    }

    const sourceName = latestSource.accountName || latestSource.accountId;
    return `${fallback} · ${sourceName.slice(0, 18)}`;
}

function displayFriendName(friend: { globalName: string | null; username: string; userId: string; }): string {
    return `${friend.globalName ?? friend.username} (${friend.userId})`;
}

function shouldLogTablistDetails(tabLists: HTMLElement[]): boolean {
    if (!settings.store.debugLogs) return false;

    const route = getCurrentRoute();
    const quickSignature = `${route}|${tabLists.length}|${tabLists.map(t => (t.innerText || "").slice(0, 40)).join("||")}`;
    const shouldLog = quickSignature !== lastTablistDebugSignature
        || Date.now() - lastTablistDebugAt >= TABLIST_DEBUG_THROTTLE_MS;

    if (shouldLog) {
        lastTablistDebugSignature = quickSignature;
        lastTablistDebugAt = Date.now();
    }

    return shouldLog;
}

function isLikelyFriendsTabList(tabList: HTMLElement): boolean {
    const aria = (tabList.getAttribute("aria-label") || "").toLowerCase();
    const text = (tabList.innerText || "").toLowerCase();

    const looksLikeFriendsAria = /friends|amis|people/.test(aria);
    const hasAddTab = /add friend|ajouter/.test(text);
    const hasAllTab = /\ball\b|tous/.test(text);

    // Exclut les tablists des pages settings/profils qui peuvent etre presentes sur /@me.
    const insideSettingsTree = Boolean(tabList.closest('[class*="standardSidebarView"], [class*="contentRegion"], [class*="settings"]'));

    return looksLikeFriendsAria && hasAddTab && hasAllTab && !insideSettingsTree;
}

function findFriendsTabList(): HTMLElement | null {
    const tabLists = Array.from(document.querySelectorAll<HTMLElement>('div[role="tablist"]'));
    const shouldLogDetails = shouldLogTablistDetails(tabLists);

    if (shouldLogDetails) {
        debugLog("Recherche tablist Amis.", {
            route: getCurrentRoute(),
            tablistCount: tabLists.length
        });
    }

    let bestMatch: { list: HTMLElement; score: number; preview: string; } | null = null;

    for (const tabList of tabLists) {
        const text = tabList.innerText || "";
        const tabs = Array.from(tabList.querySelectorAll<HTMLElement>('[role="tab"]'));
        const markerMatches = TABLIST_MARKERS.filter(marker => text.includes(marker)).length;
        const tabCountScore = tabs.length >= 3 && tabs.length <= 10 ? 2 : 0;
        const markerScore = markerMatches > 0 ? markerMatches * 3 : 0;
        const ariaScore = /friends|amis|people/i.test(tabList.getAttribute("aria-label") || "") ? 4 : 0;
        const score = tabCountScore + markerScore + ariaScore;

        const preview = text.trim().slice(0, 80);

        if (shouldLogDetails) {
            debugLog("Tablist candidate", {
                tabs: tabs.length,
                markerMatches,
                ariaLabel: tabList.getAttribute("aria-label") || "",
                preview,
                score
            });
        }

        if (!isLikelyFriendsTabList(tabList)) {
            continue;
        }

        if (!bestMatch || score > bestMatch.score) {
            bestMatch = { list: tabList, score, preview };
        }
    }

    if (bestMatch && bestMatch.score >= 3) {
        if (shouldLogDetails) {
            debugLog("Tablist Amis selectionnee (score).", {
                score: bestMatch.score,
                preview: bestMatch.preview
            });
        }
        return bestMatch.list;
    }

    if (shouldLogDetails) {
        debugLog("Aucune tablist Amis exploitable trouvee.");
    }

    return null;
}

function getTabs(tabList: HTMLElement): HTMLElement[] {
    return Array.from(tabList.querySelectorAll<HTMLElement>('[role="tab"]'));
}

function getSelectedTab(tabList: HTMLElement): HTMLElement | null {
    return tabList.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
}

function setTabSelected(tab: HTMLElement, selected: boolean): void {
    tab.setAttribute("aria-selected", selected ? "true" : "false");

    if (selected) {
        const selectedClass = tab.dataset.friendsyncSelectedClass;
        if (selectedClass) {
            tab.className = selectedClass;
        }
    } else {
        const baseClass = tab.dataset.friendsyncBaseClass;
        if (baseClass) {
            tab.className = baseClass;
        }
    }
}

function removeInlinePanel(): void {
    const existing = document.getElementById(PANEL_ID);
    if (existing?.parentElement) {
        existing.parentElement.removeChild(existing);
    }
}

function createSection(title: string, count: number, items: Array<{ globalName: string | null; username: string; userId: string; }>, color: string): HTMLElement {
    const section = document.createElement("div");
    section.style.marginTop = "12px";
    section.style.padding = "10px";
    section.style.borderRadius = "8px";
    section.style.background = "var(--background-secondary)";

    const heading = document.createElement("div");
    heading.textContent = `${title} (${count})`;
    heading.style.color = color;
    heading.style.fontWeight = "600";
    heading.style.marginBottom = "6px";

    const limit = Math.max(5, Number(settings.store.previewLimit) || 30);
    const visible = items.slice(0, limit);

    section.appendChild(heading);

    if (visible.length === 0) {
        const empty = document.createElement("div");
        empty.textContent = "Aucun";
        empty.style.opacity = "0.8";
        section.appendChild(empty);
        return section;
    }

    for (const item of visible) {
        const row = document.createElement("div");
        row.textContent = displayFriendName(item);
        row.style.padding = "6px 8px";
        row.style.borderRadius = "6px";
        row.style.opacity = "0.95";
        row.style.marginBottom = "2px";
        row.style.background = "var(--background-primary)";
        section.appendChild(row);
    }

    const hidden = Math.max(0, items.length - visible.length);
    if (hidden > 0) {
        const more = document.createElement("div");
        more.textContent = `... ${hidden} ami(s) non affiche(s)`;
        more.style.marginTop = "4px";
        more.style.opacity = "0.7";
        section.appendChild(more);
    }

    return section;
}

function renderInlinePanel(tabList: HTMLElement): void {
    removeInlinePanel();

    const mountParent = tabList.parentElement;
    if (!mountParent) {
        debugLog("Render panel annule: tabList sans parent.");
        return;
    }

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.marginTop = "8px";
    panel.style.padding = "8px 0";
    panel.style.border = "0";
    panel.style.borderRadius = "0";
    panel.style.background = "transparent";
    panel.style.color = "var(--text-normal)";
    panel.style.maxHeight = "48vh";
    panel.style.overflow = "auto";

    const title = document.createElement("div");
    title.textContent = "FriendSync";
    title.style.fontWeight = "700";
    title.style.fontSize = "16px";
    title.style.marginBottom = "4px";
    panel.appendChild(title);

    const subtitle = document.createElement("div");
    subtitle.textContent = "Liste locale des amis importes";
    subtitle.style.opacity = "0.75";
    subtitle.style.marginBottom = "10px";
    panel.appendChild(subtitle);

    const latestStatus = getLatestStatus();
    const sourcePreview = getLatestSourceFriends();
    if (!sourcePreview) {
        const now = Date.now();
        if (now - lastNoDiffLogAt >= NO_DIFF_LOG_THROTTLE_MS) {
            lastNoDiffLogAt = now;
            debugLog("Render panel: aucune liste source dispo.");
        }

        if (latestStatus?.message) {
            const status = document.createElement("div");
            status.textContent = latestStatus.message;
            status.style.marginBottom = "8px";
            status.style.padding = "8px 10px";
            status.style.borderRadius = "8px";
            status.style.background = "var(--background-secondary)";
            status.style.color = latestStatus.tone === "error"
                ? "var(--status-danger)"
                : (latestStatus.tone === "success" ? "var(--status-positive)" : "var(--text-normal)");
            panel.appendChild(status);
        }

        const empty = document.createElement("div");
        empty.textContent = "Importe une liste d'amis FriendSync puis ouvre cette categorie pour la voir ici.";
        empty.style.opacity = "0.9";
        panel.appendChild(empty);
        mountParent.appendChild(panel);
        return;
    }

    const summary = document.createElement("div");
    summary.textContent = `Liste source ${sourcePreview.accountName || sourcePreview.accountId} (${sourcePreview.friends.length})`;
    summary.style.opacity = "0.9";
    panel.appendChild(summary);

    panel.appendChild(createSection("Amis importes", sourcePreview.friends.length, sourcePreview.friends, "var(--status-positive)"));

    mountParent.appendChild(panel);
}

function deactivateCustomTab(_tabList: HTMLElement): void {
    const customTab = document.getElementById(TAB_ID) as HTMLElement | null;
    if (!customTab) return;

    customTabActive = false;
    keepCustomTabOpen = false;
    setTabSelected(customTab, false);
    removeInlinePanel();
}

function activateCustomTab(tabList: HTMLElement, forceRender = false): void {
    const customTab = document.getElementById(TAB_ID) as HTMLElement | null;
    if (!customTab) return;

    const alreadySelected = customTab.getAttribute("aria-selected") === "true";
    if (alreadySelected && customTabActive && !forceRender) {
        return;
    }

    for (const tab of getTabs(tabList)) {
        if (tab.id !== TAB_ID) {
            setTabSelected(tab, false);
        }
    }

    customTabActive = true;
    keepCustomTabOpen = true;
    setTabSelected(customTab, true);
    renderInlinePanel(tabList);
    debugLog("Categorie FriendsSync activee.");
}

function bindTabListClick(tabList: HTMLElement): void {
    if (activeTabList === tabList && tabListClickHandler) return;

    if (activeTabList && tabListClickHandler) {
        activeTabList.removeEventListener("click", tabListClickHandler, true);
    }

    activeTabList = tabList;
    tabListClickHandler = (event: MouseEvent) => {
        const target = event.target as HTMLElement | null;
        const clickedTab = target?.closest('[role="tab"]') as HTMLElement | null;
        if (!clickedTab) return;

        if (clickedTab.id === TAB_ID) {
            event.preventDefault();
            event.stopPropagation();
            activateCustomTab(tabList);
            return;
        }

        if (customTabActive) {
            deactivateCustomTab(tabList);
        }
    };

    tabList.addEventListener("click", tabListClickHandler, true);
    debugLog("Listener click tablist attache.");
}

function applyCategoryTab(): void {
    if (!settings.store.injectFriendsCategory) return;
    if (!isFriendsRoute()) return;

    const tabList = findFriendsTabList();
    if (!tabList) {
        debugLog("Injection ignoree: tablist introuvable.");
        return;
    }

    const existing = document.getElementById(TAB_ID) as HTMLElement | null;
    const label = getCategoryLabel();
    bindTabListClick(tabList);

    if (existing) {
        const labelNode = existing.querySelector("span") ?? existing;
        if (labelNode.textContent !== label) {
            labelNode.textContent = label;
            debugLog("Label categorie mis a jour:", label);
        }

        if ((customTabActive || keepCustomTabOpen) && existing.getAttribute("aria-selected") !== "true") {
            activateCustomTab(tabList);
        } else if ((customTabActive || keepCustomTabOpen) && !document.getElementById(PANEL_ID)) {
            renderInlinePanel(tabList);
        }

        return;
    }

    const templateTab = tabList.querySelector<HTMLElement>('div[role="tab"], a[role="tab"]');
    if (!templateTab) {
        debugLog("Injection annulee: template tab introuvable.");
        return;
    }

    const selectedTemplate = getSelectedTab(tabList) ?? templateTab;

    const newTab = templateTab.cloneNode(true) as HTMLElement;
    newTab.id = TAB_ID;
    newTab.setAttribute("data-friendsync", "category");
    newTab.setAttribute("aria-selected", "false");
    newTab.dataset.friendsyncBaseClass = templateTab.className;
    newTab.dataset.friendsyncSelectedClass = selectedTemplate.className;

    const span = newTab.querySelector("span");
    if (span) {
        span.textContent = label;
    } else {
        newTab.textContent = label;
    }

    tabList.appendChild(newTab);
    debugLog("Categorie FriendsSync injectee dans la section Amis.", {
        label,
        tabListClass: tabList.className
    });

    if (customTabActive || keepCustomTabOpen) {
        activateCustomTab(tabList);
    }
}

function runApplyCategoryTab(): void {
    if (applyingCategory) return;

    applyingCategory = true;
    lastApplyAt = Date.now();

    try {
        applyCategoryTab();
    } catch (error) {
        console.error("[FriendSync] Echec applyCategoryTab:", error);
    } finally {
        applyingCategory = false;
    }
}

function scheduleApplyCategoryTab(delayMs = 80, force = false): void {
    if (!force && Date.now() - lastApplyAt < APPLY_THROTTLE_MS) {
        return;
    }

    if (applyTimer) return;

    applyTimer = setTimeout(() => {
        applyTimer = null;

        if (!force && Date.now() - lastApplyAt < APPLY_THROTTLE_MS) {
            return;
        }

        runApplyCategoryTab();
    }, delayMs);
}

function removeCategoryTab(): void {
    removeInlinePanel();

    if (activeTabList && tabListClickHandler) {
        activeTabList.removeEventListener("click", tabListClickHandler, true);
    }

    activeTabList = null;
    tabListClickHandler = null;
    customTabActive = false;
    keepCustomTabOpen = false;

    const existing = document.getElementById(TAB_ID);
    if (existing?.parentElement) {
        existing.parentElement.removeChild(existing);
    }
}

export function startFriendsCategoryInjection(): void {
    if (!settings.store.injectFriendsCategory) {
        debugLog("Injection categorie desactivee par setting.");
        return;
    }

    if (typeof document === "undefined") {
        debugLog("Injection annulee: document indisponible.");
        return;
    }

    if (injectionStarted) {
        scheduleApplyCategoryTab(30, true);
        return;
    }

    injectionStarted = true;

    removeCategoryTab();
    runApplyCategoryTab();

    locationChangeHandler = () => {
        scheduleApplyCategoryTab(30, true);
    };

    window.addEventListener("hashchange", locationChangeHandler);
    window.addEventListener("popstate", locationChangeHandler);

    // Pas de polling ni observer: uniquement navigation + actions utilisateur.
    debugLog("Injection categorie FriendsSync demarree.");
}

export function stopFriendsCategoryInjection(): void {
    injectionStarted = false;

    if (locationChangeHandler) {
        window.removeEventListener("hashchange", locationChangeHandler);
        window.removeEventListener("popstate", locationChangeHandler);
        locationChangeHandler = null;
    }

    if (applyTimer) {
        clearTimeout(applyTimer);
        applyTimer = null;
    }

    removeCategoryTab();
    debugLog("Injection categorie FriendsSync arretee.");
}

export function openFriendsCategoryView(): void {
    keepCustomTabOpen = true;
    debugLog("Ouverture programmatique de la categorie FriendSync.");
    runApplyCategoryTab();

    const tabList = findFriendsTabList();
    if (tabList) {
        try {
            activateCustomTab(tabList, true);
        } catch (error) {
            console.error("[FriendSync] Echec openFriendsCategoryView/activateCustomTab:", error);
        }
    }
}
