import { type BrowserContext } from 'patchright';
import { BrowserFingerprintWithHeaders } from 'fingerprint-generator';
import type { MicrosoftRewardsBot } from '../index';
import type { Account } from '../interface/Account';
interface BrowserCreationResult {
    context: BrowserContext;
    fingerprint: BrowserFingerprintWithHeaders;
}
declare class Browser {
    private readonly bot;
    private static readonly BROWSER_ARGS;
    constructor(bot: MicrosoftRewardsBot);
    createBrowser(account: Account): Promise<BrowserCreationResult>;
    private formatProxyServer;
    generateFingerprint(isMobile: boolean): Promise<BrowserFingerprintWithHeaders>;
}
export default Browser;
//# sourceMappingURL=Browser.d.ts.map