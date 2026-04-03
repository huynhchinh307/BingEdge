import type { WebhookNtfyConfig } from '../interface/Config';
import type { LogLevel } from './Logger';
export declare function sendNtfy(config: WebhookNtfyConfig, content: string, level: LogLevel): Promise<void>;
export declare function flushNtfyQueue(timeoutMs?: number): Promise<void>;
//# sourceMappingURL=Ntfy.d.ts.map