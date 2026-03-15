/*
 * MullvadDNS Plugin
 * Forces Discord to use direct Cloudflare IPs, bypassing local DNS
 * for enhanced privacy and DNS censorship circumvention.
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Toasts } from "@webpack/common";

const PLUGIN_NAME = "MullvadDNS";
const VERSION = "1.4.0";
const CACHE_TTL_MS = 3_600_000; // 1 hour

// Static IP table — Cloudflare Anycast IPs used by Discord
const DNS_RECORDS: Record<string, string> = {
  "discord.com": "162.159.137.233",
  "gateway.discord.gg": "162.159.135.233",
  "media.discordapp.net": "152.67.79.60",
  "cdn.discordapp.com": "152.67.72.12",
  "status.discord.com": "104.18.33.247",
  "ptb.discord.com": "162.159.137.233",
  "canary.discord.com": "162.159.137.233",
  "discordapp.net": "152.67.79.60",
};

// URL path prefixes that should bypass the IP rewrite
const EXCLUDED_PATHS = ["/oauth2/", "/auth/", "/api/auth", "/api/verify"];

// Module-level state (properly reset on stop)
let originalFetch: typeof window.fetch | null = null;
let isActive = false;
let intercepting = false; // recursion guard

interface CacheEntry { ip: string; expiresAt: number; }
const dnsCache = new Map<string, CacheEntry>();
const stats = { total: 0, resolved: 0, failed: 0, cacheHits: 0 };

// ─── cache helpers ────────────────────────────────────────────────────────────

function lookupIP(hostname: string): string | null {
  const entry = dnsCache.get(hostname);
  if (entry) {
    if (Date.now() < entry.expiresAt) {
      stats.cacheHits++;
      return entry.ip;
    }
    dnsCache.delete(hostname);
  }
  const ip = DNS_RECORDS[hostname] ?? null;
  if (ip) dnsCache.set(hostname, { ip, expiresAt: Date.now() + CACHE_TTL_MS });
  return ip;
}

function isDiscordHost(hostname: string) {
  return hostname.endsWith("discord.com")
    || hostname.endsWith("discordapp.com")
    || hostname.endsWith("discordapp.net")
    || hostname.endsWith("discord.gg");
}

function shouldExclude(pathname: string) {
  const lp = pathname.toLowerCase();
  return EXCLUDED_PATHS.some(p => lp.startsWith(p));
}

// ─── patched fetch ────────────────────────────────────────────────────────────

function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (intercepting || !isActive) return originalFetch!(input, init);

  try {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(rawUrl);

    if (isDiscordHost(url.hostname) && !shouldExclude(url.pathname)) {
      stats.total++;
      const originalHostname = url.hostname;
      const ip = lookupIP(originalHostname);

      if (ip) {
        url.hostname = ip;
        stats.resolved++;

        if (settings.store.enableLogging)
          console.log(
            `%c[${PLUGIN_NAME}]%c ${originalHostname} → ${ip}`,
            "color:#4CAF50;font-weight:bold", "color:#4CAF50"
          );

        if (settings.store.showNotifications)
          Toasts.show({
            message: `DNS: ${originalHostname} → ${ip}`,
            type: Toasts.Type.SUCCESS,
            id: Toasts.genId(),
          });

        const newUrl = url.toString();
        intercepting = true;
        try {
          return originalFetch!(
            input instanceof Request ? new Request(newUrl, input) : newUrl,
            init
          );
        } finally {
          intercepting = false;
        }
      } else {
        stats.failed++;
      }
    }
  } catch {
    stats.failed++;
  }

  return originalFetch!(input, init);
}

// ─── settings ─────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
  enableLogging: {
    type: OptionType.BOOLEAN,
    description: "Log DNS resolutions to the console",
    default: true,
  },
  showNotifications: {
    type: OptionType.BOOLEAN,
    description: "Show a toast notification for each DNS resolution (noisy — disabled by default)",
    default: false,
  },
});

// ─── plugin ───────────────────────────────────────────────────────────────────

export default definePlugin({
  name: PLUGIN_NAME,
  description: `v${VERSION} — Rewrites Discord fetch requests to use direct Cloudflare IPs, bypassing local DNS for enhanced privacy and censorship circumvention`,
  authors: [{ name: "Irritably", id: 928787166916640838n }],
  settings,

  start() {
    if (isActive) return;

    originalFetch = window.fetch;
    window.fetch = patchedFetch;
    isActive = true;
    stats.total = stats.resolved = stats.failed = stats.cacheHits = 0;

    if (settings.store.enableLogging)
      console.log(
        `%c[${PLUGIN_NAME}] v${VERSION} activated — ${Object.keys(DNS_RECORDS).length} DNS records loaded`,
        "color:#4CAF50;font-weight:bold"
      );
  },

  stop() {
    if (!isActive || !originalFetch) return;

    window.fetch = originalFetch;
    originalFetch = null;
    isActive = false;
    intercepting = false;
    dnsCache.clear();

    console.log(
      `%c[${PLUGIN_NAME}] deactivated — resolved ${stats.resolved}/${stats.total} requests (${stats.cacheHits} cache hits)`,
      "color:#9E9E9E;font-weight:bold"
    );
  },
});
