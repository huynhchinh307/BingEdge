import type { Page } from 'playwright-chromium';
export interface PromptOptions {
    question: string;
    timeoutSeconds?: number;
    validate?: (input: string) => boolean;
    transform?: (input: string) => string;
}
export declare function promptInput(options: PromptOptions): Promise<string | null>;
export declare function getSubtitleMessage(page: Page): Promise<string | null>;
export declare function getErrorMessage(page: Page): Promise<string | null>;
//# sourceMappingURL=LoginUtils.d.ts.map