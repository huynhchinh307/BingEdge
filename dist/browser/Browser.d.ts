import { type BrowserContext } from 'patchright';
import { BrowserFingerprintWithHeaders } from 'fingerprint-generator';
import type { MicrosoftRewardsBot } from '../index';
import type { Account } from '../interface/Account';
interface BrowserCreationResult {
    browser: any;
    context: BrowserContext;
    fingerprint: BrowserFingerprintWithHeaders;
}
declare class Browser {
    private readonly bot;
    private static readonly BROWSER_ARGS;
    constructor(bot: MicrosoftRewardsBot);
    createBrowser(account: Account): Promise<BrowserCreationResult>;
    private formatProxyServer;
    /**
     * Convert a comma-separated bypass pattern list (e.g. `*.live.com, microsoft.com`)
     * into anchored case-insensitive RegExp objects matching hostnames.
     */
    private compileBypassPatterns;
    /**
     * Build a fully-qualified upstream proxy URL (with embedded credentials)
     * suitable for passing to proxy-chain's `upstreamProxyUrl`.
     */
    private toUpstreamUrl;
    private detectIpVersion;
    private getIpLocation;
    generateFingerprint(isMobile: boolean): Promise<BrowserFingerprintWithHeaders>;
    private checkAndRotateLocalProxy;
}
export default Browser;
//# sourceMappingURL=Browser.d.ts.map