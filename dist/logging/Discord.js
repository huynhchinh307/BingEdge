"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendDiscord = sendDiscord;
exports.flushDiscordQueue = flushDiscordQueue;
const axios_1 = __importDefault(require("axios"));
const p_queue_1 = __importDefault(require("p-queue"));
const DISCORD_LIMIT = 2000;
const discordQueue = new p_queue_1.default({
    interval: 1000,
    intervalCap: 2,
    carryoverConcurrencyCount: true
});
function truncate(text) {
    return text.length <= DISCORD_LIMIT ? text : text.slice(0, DISCORD_LIMIT - 14) + ' …(truncated)';
}
async function sendDiscord(discordUrl, content, level) {
    if (!discordUrl)
        return;
    const request = {
        method: 'POST',
        url: discordUrl,
        headers: { 'Content-Type': 'application/json' },
        data: { content: truncate(content), allowed_mentions: { parse: [] } },
        timeout: 10000
    };
    await discordQueue.add(async () => {
        try {
            await (0, axios_1.default)(request);
        }
        catch (err) {
            const status = err?.response?.status;
            if (status === 429)
                return;
        }
    });
}
async function flushDiscordQueue(timeoutMs = 5000) {
    await Promise.race([
        (async () => {
            await discordQueue.onIdle();
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('discord flush timeout')), timeoutMs))
    ]).catch(() => { });
}
//# sourceMappingURL=Discord.js.map