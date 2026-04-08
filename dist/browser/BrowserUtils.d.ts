import { type Page } from 'playwright-chromium';
import { CheerioAPI } from 'cheerio';
import { ClickOptions } from 'ghost-cursor-playwright-port';
import type { MicrosoftRewardsBot } from '../index';
export default class BrowserUtils {
    private bot;
    constructor(bot: MicrosoftRewardsBot);
    tryDismissAllMessages(page: Page): Promise<void>;
    getLatestTab(page: Page): Promise<Page>;
    reloadBadPage(page: Page): Promise<boolean>;
    closeTabs(page: Page, config?: {
        minTabs: number;
        maxTabs: number;
    }): Promise<Page>;
    loadInCheerio(data: Page | string): Promise<CheerioAPI>;
    ghostClick(page: Page, selector: string, options?: ClickOptions): Promise<boolean>;
    disableFido(page: Page): Promise<void>;
}
//# sourceMappingURL=BrowserUtils.d.ts.map