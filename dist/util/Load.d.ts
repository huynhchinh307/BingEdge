import type { Cookie } from 'playwright-chromium';
import type { BrowserFingerprintWithHeaders } from 'fingerprint-generator';
import type { Account, ConfigSaveFingerprint } from '../interface/Account';
import type { Config } from '../interface/Config';
import { dbLoadAccounts, dbSaveAccount, updateAccountStatus, getAccountStatus, getAllAccountStatuses, closeDb } from './Database';
/**
 * Đọc danh sách accounts từ SQLite.
 * Nếu DB trống: throw lỗi yêu cầu user thêm account qua dashboard.
 */
export declare function loadAccounts(): Account[];
/**
 * saveAccounts — upsert từng account vào DB.
 * Giữ lại signature để không break các nơi đang gọi.
 */
export declare function saveAccounts(accounts: Account[]): void;
export { updateAccountStatus, getAccountStatus, getAllAccountStatuses, closeDb, dbSaveAccount, dbLoadAccounts };
export { dbSaveConfig, dbDeleteAccount } from './Database';
export declare function loadConfig(): Config;
export declare function loadSessionData(sessionPath: string, email: string, saveFingerprint: ConfigSaveFingerprint, isMobile: boolean): Promise<{
    cookies: Cookie[];
    fingerprint: BrowserFingerprintWithHeaders;
}>;
export declare function saveSessionData(sessionPath: string, cookies: Cookie[], email: string, isMobile: boolean): Promise<string>;
export declare function saveFingerprintData(sessionPath: string, email: string, isMobile: boolean, fingerpint: BrowserFingerprintWithHeaders): Promise<string>;
//# sourceMappingURL=Load.d.ts.map