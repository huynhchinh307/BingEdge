/**
 * Database.ts — SQLite single source of truth
 *
 * Tables:
 *   accounts        — thông tin đăng nhập + cài đặt account
 *   app_config      — config.json lưu thành 1 dòng JSON
 *   account_status  — runtime stats (points, rank, lastUpdate, ...)
 *
 * better-sqlite3 là synchronous → dùng được trong code hiện tại không cần async.
 * WAL mode: nhiều reader + 1 writer chạy song song an toàn.
 * File DB: <project_root>/rewards_data.db
 */
import BetterSqlite3 from 'better-sqlite3';
import type { Account } from '../interface/Account';
import type { Config } from '../interface/Config';
export interface AccountStatusRow {
    email: string;
    points: number;
    initialPoints: number;
    collectedPoints: number;
    duration: number;
    rank: string;
    lastUpdate: string;
    updatedAt: number;
}
export declare function getDb(): BetterSqlite3.Database;
export declare function closeDb(): void;
/** Lấy tất cả accounts (chỉ credentials, không có runtime stats). */
export declare function dbLoadAccounts(): Account[];
/** Lấy một account theo email. */
export declare function dbLoadAccount(email: string): Account | null;
/** Thêm mới hoặc cập nhật một account (UPSERT). */
export declare function dbSaveAccount(account: Account): void;
/** Xóa account theo email. Trả về true nếu xóa được. */
export declare function dbDeleteAccount(email: string): boolean;
/** Đọc config từ DB. Trả về null nếu chưa có. */
export declare function dbLoadConfig(): Config | null;
/** Lưu config vào DB (UPSERT). */
export declare function dbSaveConfig(config: Config | string): void;
/** Upsert runtime status của một account. */
export declare function updateAccountStatus(email: string, status: {
    points?: number;
    initialPoints?: number;
    collectedPoints?: number;
    duration?: number;
    rank?: string;
    lastUpdate?: string;
}): void;
/** Lấy status của một account. */
export declare function getAccountStatus(email: string): AccountStatusRow | null;
/** Lấy toàn bộ statuses dạng map { email → row }. */
export declare function getAllAccountStatuses(): Record<string, AccountStatusRow>;
//# sourceMappingURL=Database.d.ts.map