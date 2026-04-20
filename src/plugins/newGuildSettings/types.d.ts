declare module "@api/ContextMenu" {
    export type NavContextMenuPatchCallback = (...args: any[]) => any;
    export const findGroupChildrenByChildId: (...args: any[]) => any;
}

declare module "@api/Settings" {
    export const definePluginSettings: (settings: any) => any;
}

declare module "@components/Icons" {
    export const CogWheel: any;
}

declare module "@utils/constants" {
    export const Devs: Record<string, any>;
}

declare module "@utils/types" {
    export const OptionType: Record<string, any>;
    const definePlugin: (plugin: any) => any;
    export default definePlugin;
}

declare module "@vencord/discord-types" {
    export type Guild = any;
}

declare module "@webpack" {
    export const findByCodeLazy: (...args: any[]) => any;
    export const findByPropsLazy: (...args: any[]) => any;
    export const findStoreLazy: (...args: any[]) => any;
    export const mapMangledModuleLazy: (...args: any[]) => any;
}

declare module "@webpack/common" {
    export const Button: any;
    export const ChannelStore: any;
    export const Menu: any;
    export const UserStore: any;
}
