/**
 * AccountTransfer - Plugin Vencord pour transférer les comptes entre Discord Stable/Canary/PTB
 * @author Venice
 * @version 1.0.0
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { React, useState, useEffect } from "@webpack/common";

const logger = new Logger("AccountTransfer");

// ==================== TYPES ====================

interface Account {
    token: string;
    userId: string;
    username: string;
    discriminator?: string;
    avatar?: string;
    email?: string;
    current?: boolean;
}

interface StoredAccount extends Account {
    version: string;
    addedAt: number;
}

// ==================== UTILITAIRES ====================

const STORAGE_KEY = "AccountTransfer_data";
const BACKUP_KEY = "AccountTransfer_backups";

const DiscordUtils = {
    // Chemins selon l'OS
    getPaths() {
        const platform = (window as any).DiscordNative?.process?.platform || "win32";
        const paths = {
            win32: {
                stable: "%APPDATA%/Discord",
                canary: "%APPDATA%/DiscordCanary",
                ptb: "%APPDATA%/DiscordPTB"
            },
            darwin: {
                stable: "~/Library/Application Support/discord",
                canary: "~/Library/Application Support/discordcanary",
                ptb: "~/Library/Application Support/discordptb"
            },
            linux: {
                stable: "~/.config/discord",
                canary: "~/.config/discordcanary",
                ptb: "~/.config/discordptb"
            }
        };
        return paths[platform as keyof typeof paths] || paths.linux;
    },

    getVersions(): string[] {
        return ["stable", "canary", "ptb"];
    },

    getCurrentVersion(): string {
        const userAgent = navigator.userAgent.toLowerCase();
        if (userAgent.includes("canary")) return "canary";
        if (userAgent.includes("ptb")) return "ptb";
        return "stable";
    },

    // Récupérer les comptes du localStorage
    async getStoredAccounts(version: string): Promise<Account[]> {
        const accounts: Account[] = [];
        
        try {
            // Token actuel
            const currentToken = localStorage.getItem("token")?.replace(/"/g, "");
            if (currentToken) {
                const userCache = localStorage.getItem("UserSettingsStore");
                const userInfo = userCache ? JSON.parse(userCache) : {};
                
                accounts.push({
                    token: currentToken,
                    userId: userInfo.userId || userInfo.id || "current",
                    username: userInfo.username || "Utilisateur actuel",
                    discriminator: userInfo.discriminator,
                    avatar: userInfo.avatar,
                    email: userInfo.email,
                    current: true
                });
            }

            // Multi-compte (MultiAccountStore)
            const multiAccountData = localStorage.getItem("MultiAccountStore");
            if (multiAccountData) {
                const parsed = JSON.parse(multiAccountData);
                const users = parsed.users || [];
                
                users.forEach((user: any) => {
                    if (user.token && user.token !== currentToken) {
                        accounts.push({
                            token: user.token,
                            userId: user.id,
                            username: user.username || `Compte ${user.id?.slice(0, 8)}`,
                            discriminator: user.discriminator,
                            avatar: user.avatar,
                            email: user.email
                        });
                    }
                });
            }

            // Tokens sauvegardés
            const savedTokens = localStorage.getItem("tokens");
            if (savedTokens) {
                const parsed = JSON.parse(savedTokens);
                Object.entries(parsed).forEach(([id, data]: [string, any]) => {
                    const token = typeof data === "string" ? data : data.token;
                    if (!accounts.find(a => a.token === token)) {
                        accounts.push({
                            token,
                            userId: id,
                            username: data.username || `Compte ${id.slice(0, 8)}`,
                            discriminator: data.discriminator,
                            avatar: data.avatar,
                            email: data.email
                        });
                    }
                });
            }
        } catch (error) {
            console.error(`[AccountTransfer] Erreur récupération ${version}:`, error);
        }

        return accounts;
    },

    // Sauvegarder un compte pour une version
    async saveAccountForVersion(version: string, account: Account): Promise<boolean> {
        try {
            const key = `AccountTransfer_pending_${version}`;
            const pending = JSON.parse(localStorage.getItem(key) || "[]");
            
            pending.push({
                ...account,
                transferredAt: Date.now(),
                targetVersion: version
            });
            
            localStorage.setItem(key, JSON.stringify(pending));
            
            // Ouvrir la version cible
            const protocols: Record<string, string> = {
                stable: "discord://",
                canary: "discordcanary://",
                ptb: "discordptb://"
            };
            
            const { shell } = (window as any).DiscordNative;
            if (shell?.openExternal) {
                await shell.openExternal(protocols[version]);
            }
            
            return true;
        } catch (error) {
            console.error("[AccountTransfer] Erreur sauvegarde:", error);
            return false;
        }
    }
};

const StorageUtils = {
    saveAccount(account: StoredAccount): void {
        const accounts = this.loadAccounts();
        const index = accounts.findIndex(a => a.token === account.token);
        
        if (index >= 0) accounts[index] = account;
        else accounts.push(account);
        
        localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
    },

    loadAccounts(): StoredAccount[] {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        } catch {
            return [];
        }
    },

    createBackup(): void {
        const accounts = this.loadAccounts();
        const backups = JSON.parse(localStorage.getItem(BACKUP_KEY) || "[]");
        
        backups.push({
            timestamp: Date.now(),
            accounts,
            version: "1.0.0"
        });
        
        if (backups.length > 10) backups.shift();
        localStorage.setItem(BACKUP_KEY, JSON.stringify(backups));
    },

    getBackups(): any[] {
        try {
            return JSON.parse(localStorage.getItem(BACKUP_KEY) || "[]");
        } catch {
            return [];
        }
    },

    exportAccounts(): string {
        return JSON.stringify(this.loadAccounts(), null, 2);
    },

    importAccounts(json: string): number {
        try {
            const accounts = JSON.parse(json);
            accounts.forEach((a: StoredAccount) => this.saveAccount(a));
            return accounts.length;
        } catch {
            return 0;
        }
    }
};

// ==================== STYLES ====================

const STYLES = `
.account-transfer-button {
    background: var(--brand-experiment);
    color: white;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: all 0.2s;
    margin-right: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
}
.account-transfer-button:hover {
    background: var(--brand-experiment-560);
    transform: translateY(-1px);
}
.account-transfer-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
}
.account-transfer-modal {
    background: var(--background-primary);
    border-radius: 8px;
    padding: 24px;
    min-width: 600px;
    max-width: 900px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}
.account-transfer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--background-modifier-accent);
}
.account-transfer-header h2 {
    margin: 0;
    color: var(--header-primary);
    font-size: 20px;
}
.account-transfer-columns {
    display: grid;
    grid-template-columns: 1fr auto 1fr auto 1fr;
    gap: 16px;
    align-items: start;
}
.version-column {
    background: var(--background-secondary);
    border-radius: 8px;
    padding: 16px;
    min-height: 300px;
}
.version-column h4 {
    margin: 0 0 12px 0;
    text-align: center;
    color: var(--header-primary);
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding-bottom: 8px;
    border-bottom: 2px solid var(--brand-experiment);
}
.version-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    margin-left: 8px;
}
.version-badge.stable { background: #5865F2; color: white; }
.version-badge.canary { background: #FAA61A; color: black; }
.version-badge.ptb { background: #45DDC0; color: black; }
.accounts-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.account-card {
    background: var(--background-tertiary);
    border-radius: 6px;
    padding: 12px;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 12px;
    border: 2px solid transparent;
}
.account-card:hover {
    background: var(--background-modifier-hover);
    transform: translateX(2px);
}
.account-card.selected {
    border-color: var(--brand-experiment);
    background: var(--brand-experiment-10a);
}
.account-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--background-secondary);
}
.account-info {
    flex: 1;
    min-width: 0;
}
.account-username {
    font-weight: 600;
    color: var(--header-primary);
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.account-email {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 2px;
}
.account-current-badge {
    font-size: 10px;
    background: var(--brand-experiment);
    color: white;
    padding: 2px 6px;
    border-radius: 4px;
    margin-top: 4px;
    display: inline-block;
}
.transfer-arrows {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 8px;
    padding: 20px 0;
}
.transfer-arrow-btn {
    background: var(--brand-experiment);
    color: white;
    border: none;
    padding: 10px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
}
.transfer-arrow-btn:hover:not(:disabled) {
    background: var(--brand-experiment-560);
    transform: scale(1.05);
}
.transfer-arrow-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.transfer-arrow-btn.success {
    background: var(--green-360);
}
.account-transfer-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid var(--background-modifier-accent);
}
.account-transfer-actions {
    display: flex;
    gap: 10px;
}
.btn {
    padding: 10px 20px;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.2s;
}
.btn-secondary {
    background: var(--background-secondary);
    color: var(--text-normal);
}
.btn-secondary:hover {
    background: var(--background-modifier-hover);
}
.btn-primary {
    background: var(--brand-experiment);
    color: white;
}
.btn-primary:hover {
    background: var(--brand-experiment-560);
}
.empty-state {
    text-align: center;
    padding: 40px 20px;
    color: var(--text-muted);
}
.empty-state-icon {
    font-size: 32px;
    margin-bottom: 8px;
}
.confirm-dialog-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
}
.confirm-dialog {
    background: var(--background-primary);
    padding: 24px;
    border-radius: 8px;
    max-width: 400px;
    text-align: center;
}
.confirm-dialog h3 {
    margin: 0 0 12px 0;
    color: var(--header-primary);
}
.confirm-dialog p {
    color: var(--text-normal);
    margin-bottom: 20px;
}
.confirm-dialog-buttons {
    display: flex;
    gap: 12px;
    justify-content: center;
}
.toast {
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 6px;
    color: white;
    font-weight: 500;
    z-index: 10001;
    animation: slideIn 0.3s ease;
}
.toast.success { background: var(--green-360); }
.toast.error { background: var(--red-400); }
@keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
}
`;

// ==================== COMPOSANTS ====================

// Composant AccountCard
function AccountCard({ account, selected, onClick }: { 
    account: Account; 
    selected: boolean; 
    onClick: () => void;
}) {
    const avatarUrl = account.avatar 
        ? `https://cdn.discordapp.com/avatars/${account.userId}/${account.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(account.userId || "0") % 5}.png`;

    return React.createElement("div", {
        className: `account-card ${selected ? "selected" : ""}`,
        onClick
    },
        React.createElement("img", {
            src: avatarUrl,
            alt: "",
            className: "account-avatar",
            onError: (e: any) => {
                e.target.src = "https://cdn.discordapp.com/embed/avatars/0.png";
            }
        }),
        React.createElement("div", { className: "account-info" },
            React.createElement("div", { className: "account-username" },
                account.username,
                account.discriminator && account.discriminator !== "0" 
                    ? `#${account.discriminator}` 
                    : ""
            ),
            account.email && React.createElement("div", { className: "account-email" }, account.email),
            account.current && React.createElement("span", { className: "account-current-badge" }, "Actuel")
        )
    );
}

// Composant VersionColumn
function VersionColumn({ 
    title, 
    version, 
    accounts, 
    selectedAccount, 
    onSelect 
}: { 
    title: string;
    version: string;
    accounts: Account[];
    selectedAccount: Account | null;
    onSelect: (account: Account, version: string) => void;
}) {
    return React.createElement("div", { className: "version-column" },
        React.createElement("h4", null,
            title,
            React.createElement("span", { className: `version-badge ${version}` }, version)
        ),
        React.createElement("div", { className: "accounts-list" },
            accounts.length === 0 
                ? React.createElement("div", { className: "empty-state" },
                    React.createElement("div", { className: "empty-state-icon" }, "👤"),
                    "Aucun compte"
                )
                : accounts.map((account, i) => 
                    React.createElement(AccountCard, {
                        key: `${account.userId}-${i}`,
                        account,
                        selected: selectedAccount?.token === account.token,
                        onClick: () => onSelect(account, version)
                    })
                )
        )
    );
}

// Composant ConfirmDialog
function ConfirmDialog({ 
    message, 
    onConfirm, 
    onCancel 
}: { 
    message: string; 
    onConfirm: () => void; 
    onCancel: () => void;
}) {
    return React.createElement("div", { className: "confirm-dialog-overlay" },
        React.createElement("div", { className: "confirm-dialog" },
            React.createElement("h3", null, "Confirmer le transfert"),
            React.createElement("p", null, message),
            React.createElement("div", { className: "confirm-dialog-buttons" },
                React.createElement("button", {
                    className: "btn btn-secondary",
                    onClick: onCancel
                }, "Annuler"),
                React.createElement("button", {
                    className: "btn btn-primary",
                    onClick: onConfirm
                }, "Confirmer")
            )
        )
    );
}

// Composant Toast
function Toast({ message, type, onClose }: { message: string; type: "success" | "error"; onClose: () => void }) {
    useEffect(() => {
        const timer = setTimeout(onClose, 3000);
        return () => clearTimeout(timer);
    }, [onClose]);

    return React.createElement("div", { className: `toast ${type}` }, message);
}

// Composant principal TransferModal
function TransferModal({ onClose }: { onClose: () => void }) {
    const [accounts, setAccounts] = useState<Record<string, Account[]>>({
        stable: [],
        canary: [],
        ptb: []
    });
    const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
    const [selectedFrom, setSelectedFrom] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const [showConfirm, setShowConfirm] = useState(false);
    const [pendingTransfer, setPendingTransfer] = useState<{to: string} | null>(null);
    const [toast, setToast] = useState<{message: string; type: "success" | "error"} | null>(null);
    const [transferred, setTransferred] = useState(false);

    useEffect(() => {
        loadAllAccounts();
    }, []);

    async function loadAllAccounts() {
        setLoading(true);
        const data: Record<string, Account[]> = {};
        
        for (const version of DiscordUtils.getVersions()) {
            data[version] = await DiscordUtils.getStoredAccounts(version);
        }
        
        setAccounts(data);
        setLoading(false);
    }

    function handleAccountSelect(account: Account, version: string) {
        setSelectedAccount(account);
        setSelectedFrom(version);
        setTransferred(false);
    }

    function initiateTransfer(to: string) {
        if (!selectedAccount || !selectedFrom) return;
        
        if (settings.store.confirmBeforeTransfer) {
            setPendingTransfer({ to });
            setShowConfirm(true);
        } else {
            executeTransfer(to);
        }
    }

    async function executeTransfer(to: string) {
        if (!selectedAccount || !selectedFrom) return;
        
        if (settings.store.backupBeforeTransfer) {
            StorageUtils.createBackup();
        }

        try {
            const success = await DiscordUtils.saveAccountForVersion(to, selectedAccount);
            
            if (success) {
                setTransferred(true);
                setToast({ message: `Compte transféré vers ${to.toUpperCase()}!`, type: "success" });
                
                // Mettre à jour la liste
                const updatedAccounts = { ...accounts };
                if (!updatedAccounts[to].find(a => a.token === selectedAccount.token)) {
                    updatedAccounts[to].push({ ...selectedAccount, current: false });
                }
                setAccounts(updatedAccounts);
            } else {
                setToast({ message: "Erreur lors du transfert", type: "error" });
            }
        } catch (error) {
            setToast({ message: "Erreur: " + (error as Error).message, type: "error" });
        }
        
        setShowConfirm(false);
        setPendingTransfer(null);
    }

    function handleExport() {
        const data = StorageUtils.exportAccounts();
        const blob = new Blob([data], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `discord-accounts-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setToast({ message: "Comptes exportés!", type: "success" });
    }

    function handleImport() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.onchange = async (e: any) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const text = await file.text();
            const count = StorageUtils.importAccounts(text);
            setToast({ message: `${count} compte(s) importé(s)!`, type: "success" });
            loadAllAccounts();
        };
        input.click();
    }

    const getOtherVersions = (exclude: string) => 
        DiscordUtils.getVersions().filter(v => v !== exclude);

    if (loading) {
        return React.createElement("div", { className: "account-transfer-modal-overlay" },
            React.createElement("div", { className: "account-transfer-modal" },
                React.createElement("div", { style: { textAlign: "center", padding: "40px" } },
                    React.createElement("h2", null, "Chargement des comptes..."),
                    React.createElement("p", { style: { color: "var(--text-muted)" } }, "Récupération des tokens")
                )
            )
        );
    }

    return React.createElement(React.Fragment, null,
        React.createElement("div", { className: "account-transfer-modal-overlay", onClick: onClose },
            React.createElement("div", { className: "account-transfer-modal", onClick: (e: any) => e.stopPropagation() },
                React.createElement("div", { className: "account-transfer-header" },
                    React.createElement("h2", null, "🔄 AccountTransfer"),
                    React.createElement("button", {
                        className: "btn btn-secondary",
                        onClick: onClose,
                        style: { padding: "6px 12px" }
                    }, "✕")
                ),
                
                React.createElement("p", { style: { color: "var(--text-muted)", marginBottom: "20px" } },
                    "Sélectionnez un compte, puis choisissez la version vers laquelle le transférer."
                ),
                
                React.createElement("div", { className: "account-transfer-columns" },
                    // Stable
                    React.createElement(VersionColumn, {
                        title: "Discord",
                        version: "stable",
                        accounts: accounts.stable,
                        selectedAccount,
                        onSelect: handleAccountSelect
                    }),
                    
                    // Flèches vers Canary
                    React.createElement("div", { className: "transfer-arrows" },
                        selectedFrom && selectedFrom !== "canary" && 
                            React.createElement("button", {
                                className: `transfer-arrow-btn ${transferred && pendingTransfer?.to === "canary" ? "success" : ""}`,
                                onClick: () => initiateTransfer("canary"),
                                disabled: !selectedAccount || selectedFrom === "canary"
                            }, transferred && pendingTransfer?.to === "canary" ? "✓ Transféré" : "→ Canary")
                    ),
                    
                    // Canary
                    React.createElement(VersionColumn, {
                        title: "Discord",
                        version: "canary",
                        accounts: accounts.canary,
                        selectedAccount,
                        onSelect: handleAccountSelect
                    }),
                    
                    // Flèches vers PTB
                    React.createElement("div", { className: "transfer-arrows" },
                        selectedFrom && selectedFrom !== "ptb" && 
                            React.createElement("button", {
                                className: `transfer-arrow-btn ${transferred && pendingTransfer?.to === "ptb" ? "success" : ""}`,
                                onClick: () => initiateTransfer("ptb"),
                                disabled: !selectedAccount || selectedFrom === "ptb"
                            }, transferred && pendingTransfer?.to === "ptb" ? "✓ Transféré" : "→ PTB")
                    ),
                    
                    // PTB
                    React.createElement(VersionColumn, {
                        title: "Discord",
                        version: "ptb",
                        accounts: accounts.ptb,
                        selectedAccount,
                        onSelect: handleAccountSelect
                    })
                ),
                
                // Flèches supplémentaires pour Stable
                (selectedFrom === "canary" || selectedFrom === "ptb") && 
                    React.createElement("div", { style: { display: "flex", justifyContent: "center", marginTop: "16px" } },
                        React.createElement("button", {
                            className: `transfer-arrow-btn ${transferred && pendingTransfer?.to === "stable" ? "success" : ""}`,
                            onClick: () => initiateTransfer("stable"),
                            disabled: !selectedAccount || selectedFrom === "stable"
                        }, `→ Transférer vers Stable`)
                    ),
                
                React.createElement("div", { className: "account-transfer-footer" },
                    React.createElement("div", { className: "account-transfer-actions" },
                        React.createElement("button", {
                            className: "btn btn-secondary",
                            onClick: handleExport
                        }, "📤 Exporter"),
                        React.createElement("button", {
                            className: "btn btn-secondary",
                            onClick: handleImport
                        }, "📥 Importer")
                    ),
                    React.createElement("button", {
                        className: "btn btn-primary",
                        onClick: onClose
                    }, "Fermer")
                )
            )
        ),
        
        showConfirm && React.createElement(ConfirmDialog, {
            message: `Transférer ${selectedAccount?.username} de ${selectedFrom.toUpperCase()} vers ${pendingTransfer?.to.toUpperCase()} ?`,
            onConfirm: () => executeTransfer(pendingTransfer!.to),
            onCancel: () => {
                setShowConfirm(false);
                setPendingTransfer(null);
            }
        }),
        
        toast && React.createElement(Toast, {
            message: toast.message,
            type: toast.type,
            onClose: () => setToast(null)
        })
    );
}

// ==================== PARAMÈTRES ====================

const settings = definePluginSettings({
    showTransferButton: {
        type: OptionType.BOOLEAN,
        description: "Afficher le bouton de transfert dans la barre d'utilisateur",
        default: true
    },
    confirmBeforeTransfer: {
        type: OptionType.BOOLEAN,
        description: "Demander confirmation avant chaque transfert",
        default: true
    },
    backupBeforeTransfer: {
        type: OptionType.BOOLEAN,
        description: "Créer une sauvegarde automatique avant transfert",
        default: true
    },
    autoDetectVersions: {
        type: OptionType.BOOLEAN,
        description: "Détecter automatiquement les versions installées",
        default: true
    }
});

// ==================== PLUGIN PRINCIPAL ====================

export default definePlugin({
    name: "AccountTransfer",
    description: "Transférez vos comptes Discord entre Stable, Canary et PTB facilement",
    authors: [Devs.Venice],
    settings,
    
    start() {
        logger.info("AccountTransfer démarré");
        this.injectStyles();
        this.addToolbarButton();
    },

    stop() {
        logger.info("AccountTransfer arrêté");
        this.removeStyles();
        this.removeToolbarButton();
    },

    injectStyles() {
        const style = document.createElement("style");
        style.id = "account-transfer-styles";
        style.textContent = STYLES;
        document.head.appendChild(style);
    },

    removeStyles() {
        const style = document.getElementById("account-transfer-styles");
        if (style) style.remove();
    },

    addToolbarButton() {
        if (!settings.store.showTransferButton) return;

        // Observer pour ajouter le bouton dans la barre d'utilisateur
        const observer = new MutationObserver(() => {
            const container = document.querySelector('[class*="accountProfileCard"]') || 
                           document.querySelector('[class*="sidebar"] [class*="panel"]');
            
            if (container && !container.querySelector(".account-transfer-button")) {
                const button = document.createElement("button");
                button.className = "account-transfer-button";
                button.innerHTML = "🔄 Transférer";
                button.onclick = () => this.openModal();
                
                container.appendChild(button);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
        this.observer = observer;
    },

    removeToolbarButton() {
        if (this.observer) {
            this.observer.disconnect();
        }
        document.querySelectorAll(".account-transfer-button").forEach(el => el.remove());
    },

    openModal() {
        const modal = React.createElement(TransferModal, {
            onClose: () => {
                const overlay = document.querySelector(".account-transfer-modal-overlay");
                if (overlay) {
                    const root = (overlay as any).__reactRoot;
                    if (root) root.unmount();
                    overlay.remove();
                }
            }
        });

        const container = document.createElement("div");
        container.id = "account-transfer-modal-container";
        document.body.appendChild(container);

        // Utiliser React 18 createRoot si disponible, sinon ReactDOM.render
        const ReactDOM = (window as any).ReactDOM;
        if (ReactDOM?.createRoot) {
            const root = ReactDOM.createRoot(container);
            root.render(modal);
            (container as any).__reactRoot = root;
        } else {
            ReactDOM?.render(modal, container);
        }
    },

    observer: null as MutationObserver | null
});