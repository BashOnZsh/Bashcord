/*
 * Vencord, a modification for Discord's desktop app
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { findByPropsLazy, waitFor } from "@webpack";
import { showToast as vencordShowToast, Toasts } from "@webpack/common";

type TransportOptions = Record<string, any> & {
    audioEncoder?: Record<string, any>;
};

const VoiceModule = findByPropsLazy("setLocalVolume", "mergeUsers", "setSelfMute", "setSelfDeaf");
const logger = new Logger("LightcordBitrate");

const OPUS_PROFILE = Object.freeze({
    channels: 2,
    freq: 48000,
    rate: 512000,
    minBitrate: 512000,
    maxBitrate: 512000,
    pacsize: 960,
    application: 2049,
    signal: 3002,
    bandwidth: 1105,
    complexity: 10,
    bitratePriority: 1,
    cbr: true,
    constrained_vbr: false,
    fec: false,
    dtx: false,
    packetLossRate: 0,
    stereoRedundancy: true,
    forceStereo: true
});

const TRANSPORT_PROFILE = Object.freeze({
    encodingVoiceBitRate: 512000,
    encodingBitRate: 512000,
    callBitrate: 512000,
    callMaxBitRate: 512000,
    minBitrate: 512000,
    maxBitrate: 512000,
    packetLossRate: 0,
    fec: false,
    dtx: false,
    cbr: true,
    constrained_vbr: false,
    adaptiveBitrate: false,
    adaptivePtime: false,
    adaptiveAudioPacketLoss: false,
    voiceProcessing: false,
    enableAgc: false,
    enableNS: false,
    enableAEC: false,
    enableDSP: false,
    enableRed: true,
    enableDred: true,
    enableRtx: true,
    forceAudioRedundancy: true,
    forceStereoAudio: true,
    prioritySpeakerDucking: false,
    enableAudioPacing: false
});

export default definePlugin({
    name: "LightcordBitrate",
    description: "Locks high quality Opus transport, stereo fullband audio, and disables exposed voice processing.",
    authors: [{ name: "skenzo", id: 842214916135976981n }],
    tags: ["Voice", "Utility"],

    toastShown: false,
    active: false,
    voiceModule: null as any,
    waitForVoiceModuleRegistered: false,
    watchdog: null as ReturnType<typeof setInterval> | null,
    patchedConnections: new Map<any, Function>(),
    originalVoiceMethods: new Map<string, Function>(),

    start() {
        this.active = true;
        this.showStartupToast();

        if (this.voiceModule) {
            this.installVoiceHooks(this.voiceModule);
        } else if (!this.waitForVoiceModuleRegistered) {
            this.waitForVoiceModuleRegistered = true;
            waitFor(["setLocalVolume", "mergeUsers", "setSelfMute", "setSelfDeaf"], module => {
                if (!this.active) return;

                this.voiceModule = module;
                this.installVoiceHooks(module);
            }, { isIndirect: true });
        }

        this.startWatchdog();
    },

    stop() {
        this.active = false;
        this.stopWatchdog();

        for (const [connection, originalSetTransportOptions] of this.patchedConnections.entries()) {
            try {
                connection.setTransportOptions = originalSetTransportOptions;
            } catch {
                // Ignore restoration failures.
            }
        }

        this.patchedConnections.clear();
        this.uninstallVoiceHooks();
        this.toastShown = false;

        logger.info("Stopped and restored patched connections.");
    },

    showToast(message: string, type = Toasts.Type.SUCCESS) {
        vencordShowToast(message, type, { duration: 7000 });
    },

    showStartupToast() {
        if (this.toastShown) return;

        this.toastShown = true;
        this.showToast("[ADEM] Clear filterless audio active: 512kbps CBR, stereo fullband, DSP off when exposed.");
    },

    safeCall(target: any, method: string, ...args: any[]) {
        try {
            if (target && typeof target[method] === "function") {
                target[method](...args);
            }
        } catch {
            // Best effort only.
        }
    },

    patchAudioProcessing(target: any) {
        if (!target || target.__ADEM_FILTERLESS_DSP__) return;

        try {
            Object.defineProperty(target, "__ADEM_FILTERLESS_DSP__", {
                value: true,
                configurable: true,
                enumerable: false
            });
        } catch {
            // Ignore if the target is not extensible.
        }

        const offMethods = [
            "setAutomaticGainControl",
            "setNoiseSuppression",
            "setEchoCancellation",
            "setEchoCancellationPreEcho",
            "setExperimentalEchoCancellation",
            "setExperimentalNs",
            "setTypingNoiseDetection",
            "setHighPassFilter",
            "setBeamforming",
            "setTransientSuppression",
            "setVoiceProcessing",
            "setGainControl",
            "setAnalogAgc",
            "setResidualEchoDetector",
            "setDelayAgnostic",
            "setIntelligibilityEnhancer",
            "setMultiChannelCaptureProcessing",
            "setLimiter",
            "setEchoCancellationMobileMode"
        ];

        for (const method of offMethods) {
            this.safeCall(target, method, false);
        }

        this.safeCall(target, "setAutomaticGainControlConfig", {
            targetLevel: 0,
            compressionGain: 0,
            limiterEnabled: false
        });

        this.safeCall(target, "setCodecPreferences", ["multiopus", "opus", "red"]);
        this.safeCall(target, "setMinimumOutputDelay", 20);
        this.safeCall(target, "setPlayoutDelayHint", 20);
    },

    buildTransportOptions(options: TransportOptions = {}) {
        const base = options && typeof options === "object" ? options : {};

        return {
            ...base,
            ...TRANSPORT_PROFILE,
            audioEncoder: {
                ...(base.audioEncoder || {}),
                ...OPUS_PROFILE
            }
        };
    },

    patchConnection(connection: any) {
        if (!connection || typeof connection.setTransportOptions !== "function") return;

        if (this.patchedConnections.has(connection)) {
            this.patchAudioProcessing(connection);
            return;
        }

        const originalSetTransportOptions = connection.setTransportOptions.bind(connection);
        this.patchedConnections.set(connection, originalSetTransportOptions);

        connection.setTransportOptions = (options: TransportOptions = {}) => {
            this.patchAudioProcessing(connection);
            return originalSetTransportOptions(this.buildTransportOptions(options));
        };

        this.patchAudioProcessing(connection);

        try {
            originalSetTransportOptions(this.buildTransportOptions({}));
        } catch {
            // Some connections only accept transport updates once they are live.
        }

        logger.info("Filterless transport patched.");
    },

    patchVoiceInstance(instance: any) {
        if (!instance) return;

        this.patchAudioProcessing(instance);
        if (instance.conn) this.patchConnection(instance.conn);
    },

    installVoiceHooks(voiceModule: any) {
        const prototype = voiceModule?.prototype;
        if (!prototype) {
            this.showToast("[ADEM] Voice module not found. Join a voice channel, then reload Vencord.", Toasts.Type.FAILURE);
            logger.error("Voice module not found.");
            return;
        }

        const plugin = this;
        const patchMethods = ["setLocalVolume", "mergeUsers", "setSelfMute", "setSelfDeaf"];
        for (const method of patchMethods) {
            if (typeof prototype[method] !== "function") continue;
            if (this.originalVoiceMethods.has(method)) continue;

            const originalMethod = prototype[method];
            this.originalVoiceMethods.set(method, originalMethod);

            prototype[method] = function (this: any, ...args: any[]) {
                plugin.patchVoiceInstance(this);
                return Reflect.apply(originalMethod, this, args);
            };
        }

        logger.info("Vencord hooks installed.");
    },

    uninstallVoiceHooks() {
        if (!this.voiceModule?.prototype) return;

        const prototype = this.voiceModule.prototype;
        for (const [method, originalMethod] of this.originalVoiceMethods.entries()) {
            try {
                prototype[method] = originalMethod;
            } catch {
                // Ignore restoration failures.
            }
        }

        this.originalVoiceMethods.clear();
    },

    startWatchdog() {
        this.stopWatchdog();
        this.watchdog = setInterval(() => {
            for (const connection of this.patchedConnections.keys()) {
                this.patchAudioProcessing(connection);
                try {
                    connection.setTransportOptions({});
                } catch {
                    // Ignore transient connection states.
                }
            }
        }, 15000);
    },

    stopWatchdog() {
        if (this.watchdog) {
            clearInterval(this.watchdog);
            this.watchdog = null;
        }
    }
});