import type { BrowserContext } from 'playwright-chromium';
import type { AxiosResponse } from 'axios';
import type { MicrosoftRewardsBot } from '../index';
import type { Counters, DashboardData } from './../interface/DashboardData';
import type { XboxDashboardData } from '../interface/XboxDashboardData';
import type { AppEarnablePoints, BrowserEarnablePoints, MissingSearchPoints } from '../interface/Points';
import type { AppDashboardData } from '../interface/AppDashBoardData';
export default class BrowserFunc {
    private bot;
    private accountRank;
    constructor(bot: MicrosoftRewardsBot);
    /**
     * Fetch user desktop dashboard data
     * @returns {DashboardData} Object of user bing rewards dashboard data
     */
    getDashboardData(): Promise<DashboardData>;
    getAccountRank(): string;
    private buildCookieHeader;
    /**
     * Fetch user app dashboard data
     * @returns {AppDashboardData} Object of user bing rewards dashboard data
     */
    getAppDashboardData(): Promise<AppDashboardData>;
    /**
     * Fetch user xbox dashboard data
     * @returns {XboxDashboardData} Object of user bing rewards dashboard data
     */
    getXBoxDashboardData(): Promise<XboxDashboardData>;
    /**
     * Get search point counters
     */
    getSearchPoints(): Promise<Counters>;
    missingSearchPoints(counters: Counters, isMobile: boolean): MissingSearchPoints;
    /**
     * Get total earnable points with web browser
     */
    getBrowserEarnablePoints(): Promise<BrowserEarnablePoints>;
    /**
     * Get total earnable points with mobile app
     */
    getAppEarnablePoints(): Promise<AppEarnablePoints>;
    /**
     * Get current point amount
     * @returns {number} Current total point amount
     */
    getCurrentPoints(): Promise<number>;
    closeBrowser(browser: BrowserContext, email: string): Promise<void>;
    mergeCookies(response: AxiosResponse, currentCookieHeader?: string, whitelist?: string[]): string;
    private parseAttributes;
    private updateCookie;
    private createCookie;
}
//# sourceMappingURL=BrowserFunc.d.ts.map