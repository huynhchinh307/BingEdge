import { AsyncLocalStorage } from 'node:async_hooks';
import type { Cookie, Page } from 'playwright-chromium';
import type { BrowserFingerprintWithHeaders } from 'fingerprint-generator';
import BrowserFunc from './browser/BrowserFunc';
import BrowserUtils from './browser/BrowserUtils';
import { Logger } from './logging/Logger';
import Utils from './util/Utils';
import { Workers } from './functions/Workers';
import Activities from './functions/Activities';
import type { Account } from './interface/Account';
import AxiosClient from './util/Axios';
interface ExecutionContext {
    isMobile: boolean;
    account: Account;
}
declare const executionContext: AsyncLocalStorage<ExecutionContext>;
export declare function getCurrentContext(): ExecutionContext;
interface UserData {
    userName: string;
    geoLocale: string;
    langCode: string;
    initialPoints: number;
    currentPoints: number;
    gainedPoints: number;
}
export declare class MicrosoftRewardsBot {
    logger: Logger;
    config: import("./interface/Config").Config;
    utils: Utils;
    activities: Activities;
    browser: {
        func: BrowserFunc;
        utils: BrowserUtils;
    };
    mainMobilePage: Page;
    mainDesktopPage: Page;
    userData: UserData;
    rewardsVersion: 'legacy' | 'modern';
    accessToken: string;
    requestToken: string;
    cookies: {
        mobile: Cookie[];
        desktop: Cookie[];
    };
    fingerprint: BrowserFingerprintWithHeaders;
    private pointsCanCollect;
    private activeWorkers;
    private exitedWorkers;
    private browserFactory;
    private accounts;
    workers: Workers;
    private login;
    private searchManager;
    axios: AxiosClient;
    constructor();
    get isMobile(): boolean;
    initialize(): Promise<void>;
    run(): Promise<void>;
    private testGeminiConnection;
    private runMaster;
    private runWorker;
    private runTasks;
    private getProxyKey;
    private acquireProxyLock;
    private releaseProxyLock;
    Main(account: Account): Promise<{
        initialPoints: number;
        collectedPoints: number;
        rank?: string;
    }>;
}
export { executionContext };
//# sourceMappingURL=index.d.ts.map