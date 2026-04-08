import type { BrowserContext } from 'playwright-chromium';
import type { BrowserFingerprintWithHeaders } from 'fingerprint-generator';
import { MicrosoftRewardsBot } from '../index';
import type { DashboardData } from '../interface/DashboardData';
import type { Account } from '../interface/Account';
interface BrowserSession {
    context: BrowserContext;
    fingerprint: BrowserFingerprintWithHeaders;
}
interface MissingSearchPoints {
    mobilePoints: number;
    desktopPoints: number;
}
interface SearchResults {
    mobilePoints: number;
    desktopPoints: number;
    rank?: string;
}
export declare class SearchManager {
    private bot;
    constructor(bot: MicrosoftRewardsBot);
    doSearches(data: DashboardData, missingSearchPoints: MissingSearchPoints, mobileSession: BrowserSession, account: Account, accountEmail: string): Promise<SearchResults>;
    private doParallelSearches;
    private doSequentialSearches;
    private createDesktopSession;
    private doMobileSearch;
    private doDesktopSearch;
    private doDesktopSearchSequential;
    private doDesktopWorkers;
    private doDesktopWorkSequentialInternal;
}
export {};
//# sourceMappingURL=SearchManager.d.ts.map