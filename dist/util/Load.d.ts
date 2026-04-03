import type { Cookie } from 'patchright';
import type { BrowserFingerprintWithHeaders } from 'fingerprint-generator';
import type { Account, ConfigSaveFingerprint } from '../interface/Account';
import type { Config } from '../interface/Config';
export declare function loadAccounts(): Account[];
export declare function saveAccounts(accounts: Account[]): void;
export declare function loadConfig(): Config;
export declare function loadSessionData(sessionPath: string, email: string, saveFingerprint: ConfigSaveFingerprint, isMobile: boolean): Promise<{
    cookies: Cookie[];
    fingerprint: BrowserFingerprintWithHeaders;
}>;
export declare function saveSessionData(sessionPath: string, cookies: Cookie[], email: string, isMobile: boolean): Promise<string>;
export declare function saveFingerprintData(sessionPath: string, email: string, isMobile: boolean, fingerpint: BrowserFingerprintWithHeaders): Promise<string>;
//# sourceMappingURL=Load.d.ts.map