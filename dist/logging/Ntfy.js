import axios from 'axios';
import PQueue from 'p-queue';
const ntfyQueue = new PQueue({
    interval: 1000,
    intervalCap: 2,
    carryoverConcurrencyCount: true
});
export async function sendNtfy(config, content, level) {
    if (!config?.url)
        return;
    switch (level) {
        case 'error':
            config.priority = 5; // Highest
            break;
        case 'warn':
            config.priority = 4;
            break;
        default:
            break;
    }
    const headers = { 'Content-Type': 'text/plain' };
    if (config.title)
        headers['Title'] = config.title;
    if (config.tags?.length)
        headers['Tags'] = config.tags.join(',');
    if (config.priority)
        headers['Priority'] = String(config.priority);
    if (config.token)
        headers['Authorization'] = `Bearer ${config.token}`;
    const url = config.topic ? `${config.url}/${config.topic}` : config.url;
    const request = {
        method: 'POST',
        url: url,
        headers,
        data: content,
        timeout: 10000
    };
    await ntfyQueue.add(async () => {
        try {
            await axios(request);
        }
        catch (err) {
            const status = err?.response?.status;
            if (status === 429)
                return;
        }
    });
}
export async function flushNtfyQueue(timeoutMs = 5000) {
    await Promise.race([
        (async () => {
            await ntfyQueue.onIdle();
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('ntfy flush timeout')), timeoutMs))
    ]).catch(() => { });
}
//# sourceMappingURL=Ntfy.js.map