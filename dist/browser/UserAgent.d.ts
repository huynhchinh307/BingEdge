import type { BrowserFingerprintWithHeaders } from 'fingerprint-generator';
import type { MicrosoftRewardsBot } from '../index';
export declare class UserAgentManager {
    private bot;
    private static readonly NOT_A_BRAND_VERSION;
    constructor(bot: MicrosoftRewardsBot);
    getUserAgent(isMobile: boolean, browserType: 'chromium' | 'edge'): Promise<{
        userAgent: string;
        userAgentMetadata: {
            isMobile: boolean;
            platform: string;
            fullVersionList: {
                brand: string;
                version: string;
            }[];
            brands: {
                brand: string;
                version: string;
            }[];
            platformVersion: string;
            architecture: string;
            bitness: string;
            model: string;
        };
    }>;
    getChromeVersion(isMobile: boolean): Promise<string>;
    getEdgeVersions(isMobile: boolean): Promise<{
        android: string | undefined;
        windows: string | undefined;
    }>;
    getSystemComponents(mobile: boolean): string;
    getAppComponents(isMobile: boolean): Promise<{
        not_a_brand_version: string;
        not_a_brand_major_version: string;
        edge_version: string;
        edge_major_version: string;
        chrome_version: string;
        chrome_major_version: string;
        chrome_reduced_version: string;
    }>;
    updateFingerprintUserAgent(fingerprint: BrowserFingerprintWithHeaders, isMobile: boolean): Promise<BrowserFingerprintWithHeaders>;
}
//# sourceMappingURL=UserAgent.d.ts.map