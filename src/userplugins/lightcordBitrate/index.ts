import definePlugin from "@utils/types";
import { find } from "@webpack";
import { Toasts, showToast } from "@webpack/common";

const PLUGIN_NAME = "LightcordBitrate";

let voiceModule: any = null;
let originalSetLocalVolume: ((...args: any[]) => any) | null = null;
let toastShown = false;
const patchedConnections = new Map<any, (options: any) => any>();

function showStereoWarning() {
	if (toastShown) return;
	toastShown = true;

	if (Toasts?.Type?.MESSAGE) {
		showToast(
			"Warning: Turn OFF Noise Suppression & Echo Cancellation for Stereo Sound!",
			Toasts.Type.MESSAGE,
			{ duration: 5000 }
		);
	}
}

function patchConnection(conn: any) {
	if (!conn?.setTransportOptions || patchedConnections.has(conn)) return;

	const original = conn.setTransportOptions.bind(conn);
	patchedConnections.set(conn, original);

	conn.setTransportOptions = (options: any) => {
		if (!options || typeof options !== "object") return original(options);

		Object.assign(options, {
			audioEncoder: {
				...options.audioEncoder,
				freq: 48000,
				rate: 512000,
				pacsize: 960
			},
			packetLossRate: 0,
			encodingBitRate: 512000,
			callBitrate: 512000,
			callMaxBitRate: 512000
		});

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

export default definePlugin({
	name: "LightcordBitrate",
	description: "Bitrate plugin for Vencord",
	authors: [{ name: "Bash", id: 1462173272962764850n }],
	start() {
		showStereoWarning();

		voiceModule = find((m: any) => m?.prototype && "setLocalVolume" in m.prototype);
		if (!voiceModule) return;

		patchSetLocalVolume();
	},
	stop() {
		unpatchSetLocalVolume();
		unpatchConnections();
	}
});
