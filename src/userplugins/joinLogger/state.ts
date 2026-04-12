// @ts-nocheck

export const MAX_LOGS = 300;
export const EVENT_JOIN = "join";
export const EVENT_LEAVE = "leave";

const DEDUPE_WINDOW_MS = 1500;

let logs = [];

function formatTimestamp(date = new Date()) {
    return date.toLocaleString([], {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

export function getVoiceLogs() {
    return logs;
}

export function clearVoiceLogs() {
    logs = [];
}

export function isVoiceLogEmpty() {
    return logs.length === 0;
}

export function addVoiceLog({ userId, username, displayName, guildId, type, time }) {
    const createdAt = Date.now();
    const last = logs[0];

    if (last && last.userId === userId && last.guildId === guildId && last.type === type && createdAt - last.createdAt < DEDUPE_WINDOW_MS) {
        return false;
    }

    logs.unshift({
        userId,
        username,
        displayName,
        guildId,
        type,
        time: time ?? formatTimestamp(),
        createdAt
    });

    if (logs.length > MAX_LOGS) {
        logs.length = MAX_LOGS;
    }

    return true;
}

export function getEventLabel(type) {
    return type === EVENT_LEAVE ? "Left" : "Joined";
}

export function getEventColor(type) {
    return type === EVENT_LEAVE ? "#ed4245" : "#43b581";
}

export function buildCopyText(entries = logs) {
    return entries
        .map(log => `Type: ${getEventLabel(log.type)}\nDisplay: ${log.displayName}\nUsername: ${log.username}\nID: ${log.userId}\nTime: ${log.time}\n------------------`)
        .join("\n");
}
