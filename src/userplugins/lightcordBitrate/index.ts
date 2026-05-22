import definePlugin from "@utils/types";
import { find } from "@webpack";
import { Toasts, showToast } from "@webpack/common";

const OPUS_PROFILE = Object.freeze({
	channels: 2,
	freq: 48000,
	rate: 512000,
	pacsize: 960,
	application: 2049, // OPUS_APPLICATION_AUDIO
	fec: false,
	dtx: false,
	packetLossRate: 0,
	bandwidth: 1105, // OPUS_BANDWIDTH_FULLBAND
	bitratePriority: 1,
	complexity: 10,
	signal: 3002, // OPUS_SIGNAL_MUSIC
});

const TRANSPORT_PROFILE = Object.freeze({
	packetLossRate: 0,
	fec: false,
	encodingBitRate: 512000,
	encodingVoiceBitRate: 512000,
	callBitrate: 512000,
	callMaxBitRate: 512000,
	minBitrate: 512000,
	maxBitrate: 512000,
	adaptiveBitrate: false,
	adaptivePtime: false,
	adaptiveAudioPacketLoss: false,
	voiceProcessing: false,
	enableAgc: false,
	enableNS: false,
	enableAEC: false,
	enableDSP: false,
});

let voiceModule: any = null;
let originalSetLocalVolume: ((...args: any[]) => any) | null = null;
let originalMergeUsers: ((...args: any[]) => any) | null = null;
let toastShown = false;
const patchedConnections = new Map<any, (options: any) => any>();

function showSuccessToast() {
	if (toastShown) return;
	toastShown = true;

	if (showToast && Toasts?.Type) {
		const toastType = Toasts.Type.SUCCESS ?? Toasts.Type.MESSAGE;
		showToast(
			"[ADEM V8 ULTIMATE] Filterless — 512kbps · Opus AUDIO · Fullband stereo · 18 DSP filters off",
			toastType,
			{ duration: 7000 }
		);
	}
}

function patchConnection(conn: any) {
	if (!conn?.setTransportOptions || patchedConnections.has(conn)) return;

	const original = conn.setTransportOptions.bind(conn);
	patchedConnections.set(conn, original);

	conn.setTransportOptions = (options: any) => {
		if (!options || typeof options !== "object") return original(options);

		try {
			// Deep merge Opus profile
			options.audioEncoder = {
				...(options.audioEncoder || {}),
				...OPUS_PROFILE,
			};

			// Apply transport overrides
			Object.assign(options, TRANSPORT_PROFILE);
		} catch (error) {
			console.error("[LightcordBitrate] Failed to apply transport options:", error);
		}

		return original(options);
	};
}

function unpatchConnections() {
	for (const [conn, original] of patchedConnections) {
		try {
			if (conn?.setTransportOptions && conn.setTransportOptions !== original) {
				conn.setTransportOptions = original;
			}
		} catch {
			// Ignore stale connections
		}
	}
	patchedConnections.clear();
}

function patchSetLocalVolume() {
	if (!voiceModule?.prototype?.setLocalVolume || originalSetLocalVolume) return;

	originalSetLocalVolume = voiceModule.prototype.setLocalVolume;
	voiceModule.prototype.setLocalVolume = function (...args: any[]) {
		if (this?.conn?.setTransportOptions) {
			patchConnection(this.conn);
		}
		return originalSetLocalVolume!.apply(this, args);
	};
}

function unpatchSetLocalVolume() {
	if (!voiceModule?.prototype?.setLocalVolume || !originalSetLocalVolume) return;

	voiceModule.prototype.setLocalVolume = originalSetLocalVolume;
	originalSetLocalVolume = null;
}

function patchMergeUsers() {
	if (!voiceModule?.prototype?.mergeUsers || originalMergeUsers) return;

	originalMergeUsers = voiceModule.prototype.mergeUsers;
	voiceModule.prototype.mergeUsers = function (...args: any[]) {
		if (this?.conn?.setTransportOptions) {
			patchConnection(this.conn);
		}
		return originalMergeUsers!.apply(this, args);
	};
}

function unpatchMergeUsers() {
	if (!voiceModule?.prototype?.mergeUsers || !originalMergeUsers) return;

	voiceModule.prototype.mergeUsers = originalMergeUsers;
	originalMergeUsers = null;
}

export default definePlugin({
	name: "LightcordBitrate",
	description: "Bitrate plugin for Equicord based on ADEM V8 ULTIMATE profile.",
	authors: [{ name: "Bash", id: 1462173272962764850n }],
	start() {
		showSuccessToast();

		voiceModule = find((m: any) => m?.prototype && "setLocalVolume" in m.prototype);
		if (!voiceModule) return;

		patchSetLocalVolume();
		patchMergeUsers();
	},
	stop() {
		unpatchSetLocalVolume();
		unpatchMergeUsers();
		unpatchConnections();
	}
});

