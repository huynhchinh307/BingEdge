"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dbDeleteAccount = exports.dbSaveConfig = exports.dbLoadAccounts = exports.dbSaveAccount = exports.closeDb = exports.getAllAccountStatuses = exports.getAccountStatus = exports.updateAccountStatus = void 0;
exports.loadAccounts = loadAccounts;
exports.saveAccounts = saveAccounts;
exports.loadConfig = loadConfig;
exports.loadSessionData = loadSessionData;
exports.saveSessionData = saveSessionData;
exports.saveFingerprintData = saveFingerprintData;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const Validator_1 = require("./Validator");
const Database_1 = require("./Database");
Object.defineProperty(exports, "dbLoadAccounts", { enumerable: true, get: function () { return Database_1.dbLoadAccounts; } });
Object.defineProperty(exports, "dbSaveAccount", { enumerable: true, get: function () { return Database_1.dbSaveAccount; } });
Object.defineProperty(exports, "updateAccountStatus", { enumerable: true, get: function () { return Database_1.updateAccountStatus; } });
Object.defineProperty(exports, "getAccountStatus", { enumerable: true, get: function () { return Database_1.getAccountStatus; } });
Object.defineProperty(exports, "getAllAccountStatuses", { enumerable: true, get: function () { return Database_1.getAllAccountStatuses; } });
Object.defineProperty(exports, "closeDb", { enumerable: true, get: function () { return Database_1.closeDb; } });
let configCache;
/**
 * Đọc danh sách accounts từ SQLite.
 * Nếu DB trống: throw lỗi yêu cầu user thêm account qua dashboard.
 */
function loadAccounts() {
    try {
        const accounts = (0, Database_1.dbLoadAccounts)();
        if (accounts.length === 0) {
            throw new Error('No accounts found in database.\n' +
                'Please add accounts via the dashboard or run migration from accounts.json.');
        }
        (0, Validator_1.validateAccounts)(accounts);
        return accounts;
    }
    catch (error) {
        throw new Error(error);
    }
}
/**
 * saveAccounts — upsert từng account vào DB.
 * Giữ lại signature để không break các nơi đang gọi.
 */
function saveAccounts(accounts) {
    try {
        for (const acc of accounts) {
            (0, Database_1.dbSaveAccount)(acc);
        }
    }
    catch (error) {
        console.error('[Load] saveAccounts error:', error);
    }
}
var Database_2 = require("./Database");
Object.defineProperty(exports, "dbSaveConfig", { enumerable: true, get: function () { return Database_2.dbSaveConfig; } });
Object.defineProperty(exports, "dbDeleteAccount", { enumerable: true, get: function () { return Database_2.dbDeleteAccount; } });
function loadConfig() {
    try {
        if (configCache)
            return configCache;
        const config = (0, Database_1.dbLoadConfig)();
        if (!config) {
            throw new Error('No config found in database.\n' +
                'Please configure the bot via the dashboard (Config tab).');
        }
        (0, Validator_1.validateConfig)(config);
        configCache = config;
        return configCache;
    }
    catch (error) {
        throw new Error(error);
    }
}
async function loadSessionData(sessionPath, email, saveFingerprint, isMobile) {
    try {
        const cookiesFileName = isMobile ? 'session_mobile.json' : 'session_desktop.json';
        const cookieFile = path_1.default.join(__dirname, '../browser/', sessionPath, email, cookiesFileName);
        let cookies = [];
        if (fs_1.default.existsSync(cookieFile)) {
            const cookiesData = await fs_1.default.promises.readFile(cookieFile, 'utf-8');
            cookies = JSON.parse(cookiesData);
        }
        // Fallback to cross-platform session if current is missing or empty
        if (cookies.length === 0) {
            const fallbackFileName = isMobile ? 'session_desktop.json' : 'session_mobile.json';
            const fallbackFile = path_1.default.join(__dirname, '../browser/', sessionPath, email, fallbackFileName);
            if (fs_1.default.existsSync(fallbackFile)) {
                const fallbackData = await fs_1.default.promises.readFile(fallbackFile, 'utf-8');
                cookies = JSON.parse(fallbackData);
            }
        }
        const fingerprintFileName = isMobile ? 'session_fingerprint_mobile.json' : 'session_fingerprint_desktop.json';
        const fingerprintFile = path_1.default.join(__dirname, '../browser/', sessionPath, email, fingerprintFileName);
        let fingerprint;
        const shouldLoadFingerprint = isMobile ? saveFingerprint.mobile : saveFingerprint.desktop;
        if (shouldLoadFingerprint && fs_1.default.existsSync(fingerprintFile)) {
            const fingerprintData = await fs_1.default.promises.readFile(fingerprintFile, 'utf-8');
            fingerprint = JSON.parse(fingerprintData);
        }
        return {
            cookies: cookies,
            fingerprint: fingerprint
        };
    }
    catch (error) {
        throw new Error(error);
    }
}
async function saveSessionData(sessionPath, cookies, email, isMobile) {
    try {
        const sessionDir = path_1.default.join(__dirname, '../browser/', sessionPath, email);
        const cookiesFileName = isMobile ? 'session_mobile.json' : 'session_desktop.json';
        if (!fs_1.default.existsSync(sessionDir)) {
            await fs_1.default.promises.mkdir(sessionDir, { recursive: true });
        }
        await fs_1.default.promises.writeFile(path_1.default.join(sessionDir, cookiesFileName), JSON.stringify(cookies));
        return sessionDir;
    }
    catch (error) {
        throw new Error(error);
    }
}
async function saveFingerprintData(sessionPath, email, isMobile, fingerpint) {
    try {
        const sessionDir = path_1.default.join(__dirname, '../browser/', sessionPath, email);
        const fingerprintFileName = isMobile ? 'session_fingerprint_mobile.json' : 'session_fingerprint_desktop.json';
        if (!fs_1.default.existsSync(sessionDir)) {
            await fs_1.default.promises.mkdir(sessionDir, { recursive: true });
        }
        await fs_1.default.promises.writeFile(path_1.default.join(sessionDir, fingerprintFileName), JSON.stringify(fingerpint));
        return sessionDir;
    }
    catch (error) {
        throw new Error(error);
    }
}
//# sourceMappingURL=Load.js.map