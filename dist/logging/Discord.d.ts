import type { LogLevel } from './Logger';
export interface DiscordConfig {
    enabled?: boolean;
    url: string;
}
export declare function sendDiscord(discordUrl: string, content: string, level: LogLevel): Promise<void>;
export declare function flushDiscordQueue(timeoutMs?: number): Promise<void>;
//# sourceMappingURL=Discord.d.ts.map