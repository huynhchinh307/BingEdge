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
import BetterSqlite3 from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

import type { Account } from '../interface/Account'
import type { Config } from '../interface/Config'

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface AccountStatusRow {
    email: string
    points: number
    initialPoints: number
    collectedPoints: number
    duration: number
    rank: string
    lastUpdate: string
    updatedAt: number
}

// ──────────────────────────────────────────────
// Singleton DB
// ──────────────────────────────────────────────

let _db: BetterSqlite3.Database | null = null

export function getDb(): BetterSqlite3.Database {
    if (_db) return _db

    const dbPath = path.join(process.cwd(), 'rewards_data.db')
    _db = new BetterSqlite3(dbPath)

    _db.pragma('journal_mode = WAL')
    _db.pragma('synchronous = NORMAL')
    _db.pragma('foreign_keys = ON')

    _db.exec(`
        -- Account credentials & settings
        CREATE TABLE IF NOT EXISTS accounts (
            email            TEXT PRIMARY KEY,
            password         TEXT NOT NULL DEFAULT '',
            totp_secret      TEXT NOT NULL DEFAULT '',
            recovery_email   TEXT NOT NULL DEFAULT '',
            geo_locale       TEXT NOT NULL DEFAULT 'auto',
            lang_code        TEXT NOT NULL DEFAULT 'en',
            proxy            TEXT NOT NULL DEFAULT '{}',
            save_fingerprint TEXT NOT NULL DEFAULT '{"mobile":true,"desktop":true}',
            created_at       INTEGER NOT NULL DEFAULT 0,
            updated_at       INTEGER NOT NULL DEFAULT 0
        );

        -- Global app config (single row, stored as JSON blob)
        CREATE TABLE IF NOT EXISTS app_config (
            id   INTEGER PRIMARY KEY DEFAULT 1,
            data TEXT NOT NULL DEFAULT '{}'
        );

        -- Runtime stats per account
        CREATE TABLE IF NOT EXISTS account_status (
            email            TEXT PRIMARY KEY,
            points           INTEGER NOT NULL DEFAULT 0,
            initial_points   INTEGER NOT NULL DEFAULT 0,
            collected_points INTEGER NOT NULL DEFAULT 0,
            duration         REAL    NOT NULL DEFAULT 0,
            rank             TEXT    NOT NULL DEFAULT '',
            last_update      TEXT    NOT NULL DEFAULT 'Never',
            updated_at       INTEGER NOT NULL DEFAULT 0
        );
    `)

    // Auto-migrate from JSON files if tables are empty
    _migrateFromJson(_db)

    return _db
}

export function closeDb(): void {
    if (_db) {
        _db.close()
        _db = null
    }
}

// ──────────────────────────────────────────────
// Migration from JSON (chạy 1 lần khi DB mới)
// ──────────────────────────────────────────────

function _migrateFromJson(db: BetterSqlite3.Database): void {
    // --- Accounts ---
    const accCount = (db.prepare('SELECT COUNT(*) as c FROM accounts').get() as any).c
    if (accCount === 0) {
        const paths = [
            path.join(process.cwd(), 'accounts.json'),
            path.join(process.cwd(), 'dist', 'accounts.json'),
            path.join(process.cwd(), 'src', 'accounts.json'),
        ]
        for (const p of paths) {
            if (!fs.existsSync(p)) continue
            try {
                const list: Account[] = JSON.parse(fs.readFileSync(p, 'utf-8'))
                if (!Array.isArray(list) || list.length === 0) continue

                const insertAcc = db.prepare(`
                    INSERT OR IGNORE INTO accounts
                        (email, password, totp_secret, recovery_email, geo_locale, lang_code,
                         proxy, save_fingerprint, created_at, updated_at)
                    VALUES
                        (@email, @password, @totpSecret, @recoveryEmail, @geoLocale, @langCode,
                         @proxy, @saveFingerprint, @createdAt, @updatedAt)
                `)
                const insertStatus = db.prepare(`
                    INSERT OR IGNORE INTO account_status
                        (email, points, initial_points, collected_points, duration, rank, last_update, updated_at)
                    VALUES
                        (@email, @points, @initialPoints, @collectedPoints, @duration, @rank, @lastUpdate, @updatedAt)
                `)

                const now = Date.now()
                db.transaction(() => {
                    for (const a of list) {
                        if (!a.email) continue
                        insertAcc.run({
                            email: a.email,
                            password: a.password || '',
                            totpSecret: a.totpSecret || '',
                            recoveryEmail: a.recoveryEmail || '',
                            geoLocale: a.geoLocale || 'auto',
                            langCode: a.langCode || 'en',
                            proxy: JSON.stringify(a.proxy || {}),
                            saveFingerprint: JSON.stringify(a.saveFingerprint || { mobile: true, desktop: true }),
                            createdAt: now,
                            updatedAt: now,
                        })
                        // Migrate runtime fields nếu có trong JSON cũ
                        if (a.points !== undefined || a.lastUpdate) {
                            insertStatus.run({
                                email: a.email,
                                points: a.points ?? 0,
                                initialPoints: a.initialPoints ?? 0,
                                collectedPoints: a.collectedPoints ?? 0,
                                duration: a.duration ?? 0,
                                rank: a.rank || '',
                                lastUpdate: a.lastUpdate || 'Never',
                                updatedAt: now,
                            })
                        }
                    }
                })()

                console.log(`[DB] Migrated ${list.length} accounts from ${p}`)
                break
            } catch { /* ignore parse errors */ }
        }
    }

    // --- Config ---
    const cfgCount = (db.prepare('SELECT COUNT(*) as c FROM app_config').get() as any).c
    if (cfgCount === 0) {
        const paths = [
            path.join(process.cwd(), 'config.json'),
            path.join(process.cwd(), 'dist', 'config.json'),
            path.join(process.cwd(), 'src', 'config.json'),
        ]
        for (const p of paths) {
            if (!fs.existsSync(p)) continue
            try {
                const raw = fs.readFileSync(p, 'utf-8')
                JSON.parse(raw) // validate JSON
                db.prepare('INSERT INTO app_config (id, data) VALUES (1, ?)').run(raw)
                console.log(`[DB] Migrated config from ${p}`)
                break
            } catch { /* ignore */ }
        }

        // Nếu vẫn trống (không tìm thấy file JSON nào), tạo config mặc định tối thiểu
        const finalCfgCount = (db.prepare('SELECT COUNT(*) as c FROM app_config').get() as any).c
        if (finalCfgCount === 0) {
            const defaultConfig = {
                baseURL: 'https://rewards.bing.com',
                sessionPath: 'sessions',
                headless: false,
                browserType: 'edge',
                runOnZeroPoints: false,
                clusters: 1,
                errorDiagnostics: true,
                debugLogs: false,
                workers: {
                    doDailySet: true,
                    doSpecialPromotions: true,
                    doMorePromotions: true,
                    doPunchCards: true,
                    doAppPromotions: true,
                    doDesktopSearch: true,
                    doMobileSearch: true,
                    doDailyCheckIn: true,
                    doReadToEarn: true
                },
                searchOnBingLocalQueries: false,
                globalTimeout: 120000,
                searchSettings: {
                    queryEngines: ['google', 'wikipedia', 'reddit', 'local'],
                    scrollRandomResults: true,
                    clickRandomResults: true,
                    parallelSearching: false,
                    searchResultVisitTime: '5-10s',
                    searchDelay: { min: '2s', max: '5s' },
                    readDelay: { min: '1s', max: '3s' }
                },
                proxy: {
                    enable: false,
                    url: '',
                    port: '',
                    username: '',
                    password: '',
                    queryEngine: false
                },
                consoleLogFilter: {
                    enabled: false,
                    mode: 'blacklist',
                    levels: ['debug'],
                    keywords: [],
                    regexPatterns: []
                },
                webhook: {
                    discord: {
                        enabled: false,
                        url: ''
                    },
                    webhookLogFilter: {
                        enabled: false,
                        mode: 'blacklist',
                        levels: ['error'],
                        keywords: [],
                        regexPatterns: []
                    }
                },
                geminiApiKey: '',
                geminiModel: 'gemini-1.5-flash',
                geminiEndpoint: 'https://generativelanguage.googleapis.com'
            };
            db.prepare('INSERT INTO app_config (id, data) VALUES (1, ?)').run(JSON.stringify(defaultConfig, null, 2));
            console.log('[DB] No config found, initialized with default values.');
        }
    }
}

// ──────────────────────────────────────────────
// Accounts CRUD
// ──────────────────────────────────────────────

function _rowToAccount(row: any): Account {
    return {
        email: row.email,
        password: row.password,
        totpSecret: row.totp_secret || undefined,
        recoveryEmail: row.recovery_email,
        geoLocale: row.geo_locale,
        langCode: row.lang_code,
        proxy: _safeParse(row.proxy, {}),
        saveFingerprint: _safeParse(row.save_fingerprint, { mobile: true, desktop: true }),
    }
}

function _accountToRow(a: Account, now: number) {
    return {
        email: a.email,
        password: a.password || '',
        totpSecret: a.totpSecret || '',
        recoveryEmail: a.recoveryEmail || '',
        geoLocale: a.geoLocale || 'auto',
        langCode: a.langCode || 'vi',
        proxy: JSON.stringify(a.proxy || {}),
        saveFingerprint: JSON.stringify(a.saveFingerprint || { mobile: true, desktop: true }),
        updatedAt: now,
    }
}

/** Lấy tất cả accounts (chỉ credentials, không có runtime stats). */
export function dbLoadAccounts(): Account[] {
    try {
        return (getDb().prepare('SELECT * FROM accounts ORDER BY created_at ASC').all() as any[])
            .map(_rowToAccount)
    } catch {
        return []
    }
}

/** Lấy một account theo email. */
export function dbLoadAccount(email: string): Account | null {
    try {
        const row = getDb().prepare('SELECT * FROM accounts WHERE email = ?').get(email) as any
        return row ? _rowToAccount(row) : null
    } catch {
        return null
    }
}

/** Thêm mới hoặc cập nhật một account (UPSERT). */
export function dbSaveAccount(account: Account): void {
    const now = Date.now()
    const row = _accountToRow(account, now)
    getDb().prepare(`
        INSERT INTO accounts
            (email, password, totp_secret, recovery_email, geo_locale, lang_code,
             proxy, save_fingerprint, created_at, updated_at)
        VALUES
            (@email, @password, @totpSecret, @recoveryEmail, @geoLocale, @langCode,
             @proxy, @saveFingerprint, @updatedAt, @updatedAt)
        ON CONFLICT(email) DO UPDATE SET
            password         = @password,
            totp_secret      = @totpSecret,
            recovery_email   = @recoveryEmail,
            geo_locale       = @geoLocale,
            lang_code        = @langCode,
            proxy            = @proxy,
            save_fingerprint = @saveFingerprint,
            updated_at       = @updatedAt
    `).run(row)
}

/** Xóa account theo email. Trả về true nếu xóa được. */
export function dbDeleteAccount(email: string): boolean {
    const result = getDb().prepare('DELETE FROM accounts WHERE email = ?').run(email)
    return result.changes > 0
}

// ──────────────────────────────────────────────
// Config CRUD
// ──────────────────────────────────────────────

/** Đọc config từ DB. Trả về null nếu chưa có. */
export function dbLoadConfig(): Config | null {
    try {
        const row = getDb().prepare('SELECT data FROM app_config WHERE id = 1').get() as any
        return row ? JSON.parse(row.data) : null
    } catch {
        return null
    }
}

/** Lưu config vào DB (UPSERT). */
export function dbSaveConfig(config: Config | string): void {
    const data = typeof config === 'string' ? config : JSON.stringify(config, null, 2)
    // Validate JSON
    JSON.parse(data)
    getDb().prepare(`
        INSERT INTO app_config (id, data) VALUES (1, @data)
        ON CONFLICT(id) DO UPDATE SET data = @data
    `).run({ data })
}

// ──────────────────────────────────────────────
// Account Status CRUD
// ──────────────────────────────────────────────

/** Upsert runtime status của một account. */
export function updateAccountStatus(
    email: string,
    status: {
        points?: number
        initialPoints?: number
        collectedPoints?: number
        duration?: number
        rank?: string
        lastUpdate?: string
    }
): void {
    try {
        getDb().prepare(`
            INSERT INTO account_status
                (email, points, initial_points, collected_points, duration, rank, last_update, updated_at)
            VALUES
                (@email,
                 COALESCE(@points, 0),
                 COALESCE(@initialPoints, 0),
                 COALESCE(@collectedPoints, 0),
                 COALESCE(@duration, 0),
                 COALESCE(@rank, ''),
                 COALESCE(@lastUpdate, 'Never'),
                 @updatedAt)
            ON CONFLICT(email) DO UPDATE SET
                points           = COALESCE(@points,          points),
                initial_points   = COALESCE(@initialPoints,   initial_points),
                collected_points = COALESCE(@collectedPoints, collected_points),
                duration         = COALESCE(@duration,        duration),
                rank             = COALESCE(@rank,            rank),
                last_update      = COALESCE(@lastUpdate,      last_update),
                updated_at       = @updatedAt
        `).run({
            email,
            points: status.points ?? null,
            initialPoints: status.initialPoints ?? null,
            collectedPoints: status.collectedPoints ?? null,
            duration: status.duration ?? null,
            rank: status.rank ?? null,
            lastUpdate: status.lastUpdate ?? null,
            updatedAt: Date.now(),
        })
    } catch (e) {
        console.error('[DB] updateAccountStatus error:', e)
    }
}

/** Lấy status của một account. */
export function getAccountStatus(email: string): AccountStatusRow | null {
    try {
        const row = getDb().prepare('SELECT * FROM account_status WHERE email = ?').get(email) as any
        return row ? _mapStatusRow(row) : null
    } catch {
        return null
    }
}

/** Lấy toàn bộ statuses dạng map { email → row }. */
export function getAllAccountStatuses(): Record<string, AccountStatusRow> {
    try {
        const result: Record<string, AccountStatusRow> = {}
        for (const row of getDb().prepare('SELECT * FROM account_status').all() as any[]) {
            result[row.email] = _mapStatusRow(row)
        }
        return result
    } catch {
        return {}
    }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function _mapStatusRow(row: any): AccountStatusRow {
    return {
        email: row.email,
        points: row.points,
        initialPoints: row.initial_points,
        collectedPoints: row.collected_points,
        duration: row.duration,
        rank: row.rank,
        lastUpdate: row.last_update,
        updatedAt: row.updated_at,
    }
}

function _safeParse(json: string, fallback: any): any {
    try { return JSON.parse(json) } catch { return fallback }
}
