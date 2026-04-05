import type { Cookie } from 'patchright'
import type { BrowserFingerprintWithHeaders } from 'fingerprint-generator'
import fs from 'fs'
import path from 'path'

import type { Account, ConfigSaveFingerprint } from '../interface/Account'
import type { Config } from '../interface/Config'
import { validateAccounts, validateConfig } from './Validator'
import {
    dbLoadAccounts,
    dbSaveAccount,
    dbLoadConfig,
    updateAccountStatus,
    getAccountStatus,
    getAllAccountStatuses,
    closeDb,
} from './Database'

let configCache: Config

/**
 * Đọc danh sách accounts từ SQLite.
 * Nếu DB trống: throw lỗi yêu cầu user thêm account qua dashboard.
 */
export function loadAccounts(): Account[] {
    try {
        const accounts = dbLoadAccounts()
        if (accounts.length === 0) {
            throw new Error(
                'No accounts found in database.\n' +
                'Please add accounts via the dashboard or run migration from accounts.json.'
            )
        }
        validateAccounts(accounts)
        return accounts
    } catch (error) {
        throw new Error(error as string)
    }
}

/**
 * saveAccounts — upsert từng account vào DB.
 * Giữ lại signature để không break các nơi đang gọi.
 */
export function saveAccounts(accounts: Account[]): void {
    try {
        for (const acc of accounts) {
            dbSaveAccount(acc)
        }
    } catch (error) {
        console.error('[Load] saveAccounts error:', error)
    }
}

// Re-export DB helpers
export { updateAccountStatus, getAccountStatus, getAllAccountStatuses, closeDb, dbSaveAccount, dbLoadAccounts }
export { dbSaveConfig, dbDeleteAccount } from './Database'


export function loadConfig(): Config {
    try {
        if (configCache) return configCache
        const config = dbLoadConfig()
        if (!config) {
            throw new Error(
                'No config found in database.\n' +
                'Please configure the bot via the dashboard (Config tab).'
            )
        }
        validateConfig(config)
        configCache = config
        return configCache
    } catch (error) {
        throw new Error(error as string)
    }
}

export async function loadSessionData(
    sessionPath: string,
    email: string,
    saveFingerprint: ConfigSaveFingerprint,
    isMobile: boolean
) {
    try {
        const cookiesFileName = isMobile ? 'session_mobile.json' : 'session_desktop.json'
        const cookieFile = path.join(__dirname, '../browser/', sessionPath, email, cookiesFileName)

        let cookies: Cookie[] = []
        if (fs.existsSync(cookieFile)) {
            const cookiesData = await fs.promises.readFile(cookieFile, 'utf-8')
            cookies = JSON.parse(cookiesData)
        }
        
        // Fallback to cross-platform session if current is missing or empty
        if (cookies.length === 0) {
            const fallbackFileName = isMobile ? 'session_desktop.json' : 'session_mobile.json'
            const fallbackFile = path.join(__dirname, '../browser/', sessionPath, email, fallbackFileName)
            if (fs.existsSync(fallbackFile)) {
                const fallbackData = await fs.promises.readFile(fallbackFile, 'utf-8')
                cookies = JSON.parse(fallbackData)
            }
        }

        const fingerprintFileName = isMobile ? 'session_fingerprint_mobile.json' : 'session_fingerprint_desktop.json'
        const fingerprintFile = path.join(__dirname, '../browser/', sessionPath, email, fingerprintFileName)

        let fingerprint!: BrowserFingerprintWithHeaders
        const shouldLoadFingerprint = isMobile ? saveFingerprint.mobile : saveFingerprint.desktop
        if (shouldLoadFingerprint && fs.existsSync(fingerprintFile)) {
            const fingerprintData = await fs.promises.readFile(fingerprintFile, 'utf-8')
            fingerprint = JSON.parse(fingerprintData)
        }

        return {
            cookies: cookies,
            fingerprint: fingerprint
        }
    } catch (error) {
        throw new Error(error as string)
    }
}

export async function saveSessionData(
    sessionPath: string,
    cookies: Cookie[],
    email: string,
    isMobile: boolean
): Promise<string> {
    try {
        const sessionDir = path.join(__dirname, '../browser/', sessionPath, email)
        const cookiesFileName = isMobile ? 'session_mobile.json' : 'session_desktop.json'

        if (!fs.existsSync(sessionDir)) {
            await fs.promises.mkdir(sessionDir, { recursive: true })
        }

        await fs.promises.writeFile(path.join(sessionDir, cookiesFileName), JSON.stringify(cookies))

        return sessionDir
    } catch (error) {
        throw new Error(error as string)
    }
}

export async function saveFingerprintData(
    sessionPath: string,
    email: string,
    isMobile: boolean,
    fingerpint: BrowserFingerprintWithHeaders
): Promise<string> {
    try {
        const sessionDir = path.join(__dirname, '../browser/', sessionPath, email)
        const fingerprintFileName = isMobile ? 'session_fingerprint_mobile.json' : 'session_fingerprint_desktop.json'

        if (!fs.existsSync(sessionDir)) {
            await fs.promises.mkdir(sessionDir, { recursive: true })
        }

        await fs.promises.writeFile(path.join(sessionDir, fingerprintFileName), JSON.stringify(fingerpint))

        return sessionDir
    } catch (error) {
        throw new Error(error as string)
    }
}
