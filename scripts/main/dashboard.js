import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { getDirname, getProjectRoot, loadAccounts, log } from '../utils.js';
import axios from 'axios';
import Database from 'better-sqlite3';

const __dirname = getDirname(import.meta.url);
const projectRoot = getProjectRoot(__dirname);

// Track active processes and their limits
const activeProcesses = {};
const processLogs = {}; // key -> string[]

// Persist account stats in memory only (parsed from live bot logs)
let accountStats = {}; // email -> { total, oldBalance, newBalance, duration, completedAt }

/**
 * Read-write SQLite connection dùng chung cho accounts, config, account_status.
 * WAL mode: dashboard ghi accounts/config, bot ghi account_status — không block nhau.
 */
let _db = null;
let _statusCache = null;
let _statusCacheTime = 0;
const STATUS_CACHE_MS = 1500;

function getDb() {
    if (_db) return _db;
    try {
        const dbPath = path.join(projectRoot, 'rewards_data.db');
        _db = new Database(dbPath);
        _db.pragma('journal_mode = WAL');
        _db.pragma('synchronous = NORMAL');
        // Đảm bảo các bảng tồn tại (dashboard có thể khởi động trước bot)
        _db.exec(`
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
                updated_at       INTEGER NOT NULL DEFAULT 0,
                account_group    TEXT NOT NULL DEFAULT 'Ungrouped'
            );
            CREATE TABLE IF NOT EXISTS app_config (
                id   INTEGER PRIMARY KEY DEFAULT 1,
                data TEXT NOT NULL DEFAULT '{}'
            );
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
        `);

        // Đảm bảo cột account_group tồn tại nếu đã có DB cũ
        try {
            _db.prepare("ALTER TABLE accounts ADD COLUMN account_group TEXT NOT NULL DEFAULT 'Ungrouped'").run();
            log('INFO', '[DB] Added account_group column to accounts table.');
        } catch(e) { /* Cột đã tồn tại */ }

        // Khởi tạo config mặc định nếu chưa có
        const cfgCount = (_db.prepare('SELECT COUNT(*) as c FROM app_config').get()).c;
        if (cfgCount === 0) {
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
            _db.prepare('INSERT INTO app_config (id, data) VALUES (1, ?)').run(JSON.stringify(defaultConfig, null, 2));
            log('INFO', '[DB] Initialized app_config with default values.');
        }

        return _db;
    } catch (e) {
        log('ERROR', '[DB] Could not open rewards_data.db:', e.message);
        return null;
    }
}

function loadAccountStatus() {
    const now = Date.now();
    if (_statusCache !== null && now - _statusCacheTime < STATUS_CACHE_MS) {
        return _statusCache;
    }
    try {
        const db = getDb();
        if (!db) { _statusCache = {}; _statusCacheTime = now; return _statusCache; }
        const rows = db.prepare('SELECT * FROM account_status').all();
        const result = {};
        for (const row of rows) {
            result[row.email] = {
                points:          row.points,
                initialPoints:   row.initial_points,
                collectedPoints: row.collected_points,
                duration:        row.duration,
                rank:            row.rank,
                lastUpdate:      row.last_update
            };
        }
        _statusCache = result;
    } catch {
        _statusCache = {};
    }
    _statusCacheTime = now;
    return _statusCache;
}

function saveAccountStats() { /* in-memory only */ }

function _safeParse(json, fallback) {
    try { return JSON.parse(json); } catch { return fallback; }
}


// Parse ACCOUNT-END log line to extract stats
// Format: ... [ACCOUNT-END] Completed account: email | Total: +N | Old: X → New: Y | Duration: Z.Ws
function parseAccountEndLog(line, email) {
    if (!line.includes('[ACCOUNT-END]')) return;
    const totalMatch = line.match(/Total: ([+-]?\d+)/);
    const oldMatch = line.match(/Old: (\d+)/);
    const newMatch = line.match(/New: (\d+)/);
    const durMatch = line.match(/Duration: ([\d.]+)s/);
    const rankMatch = line.match(/Rank: ([^|]*)/);
    if (totalMatch) {
        accountStats[email] = {
            total: parseInt(totalMatch[1]),
            oldBalance: oldMatch ? parseInt(oldMatch[1]) : null,
            newBalance: newMatch ? parseInt(newMatch[1]) : null,
            duration: durMatch ? parseFloat(durMatch[1]) : null,
            rank: rankMatch ? rankMatch[1].trim() : (accountStats[email]?.rank || null),
            completedAt: new Date().toISOString()
        };
        saveAccountStats();
    }
}

// CPU usage sampler
let lastCpuSample = os.cpus();
let cpuUsagePercent = 0;

function sampleCpu() {
    const currentCpus = os.cpus();
    let totalIdle = 0, totalTick = 0;
    for (let i = 0; i < currentCpus.length; i++) {
        const curr = currentCpus[i].times;
        const prev = lastCpuSample[i].times;
        const idle = curr.idle - prev.idle;
        const total = Object.values(curr).reduce((a, b) => a + b, 0)
                    - Object.values(prev).reduce((a, b) => a + b, 0);
        totalIdle += idle;
        totalTick += total;
    }
    cpuUsagePercent = totalTick > 0 ? Math.round((1 - totalIdle / totalTick) * 100) : 0;
    lastCpuSample = currentCpus;
}
setInterval(sampleCpu, 1000);

const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.method === 'GET' && req.url === '/') {
        const htmlPath = path.join(__dirname, 'dashboard.html');
        // Serve HTML
        if (fs.existsSync(htmlPath)) {
            const html = fs.readFileSync(htmlPath, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
        } else {
            res.writeHead(404);
            res.end('dashboard.html not found');
        }
        return;
    }

    if (req.method === 'GET' && req.url === '/api/stats') {
        const totalRam = os.totalmem();
        const freeRam = os.freemem();
        const usedRam = totalRam - freeRam;
        const toGB = (b) => (b / 1024 / 1024 / 1024).toFixed(1);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            cpu: cpuUsagePercent,
            cpuModel: os.cpus()[0]?.model?.split(' ').slice(0, 3).join(' ') || 'CPU',
            cpuCores: os.cpus().length,
            ramUsed: toGB(usedRam),
            ramTotal: toGB(totalRam),
            ramPercent: Math.round((usedRam / totalRam) * 100),
            activeSessions: Object.keys(activeProcesses).length,
            platform: os.platform(),
            uptime: Math.floor(os.uptime())
        }));
        return;
    }

    if (req.method === 'GET' && req.url === '/api/config') {
        try {
            const db = getDb();
            const row = db?.prepare('SELECT data FROM app_config WHERE id = 1').get();
            if (!row) throw new Error('Config not found in DB');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, config: row.data }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: e.message }));
        }
        return;
    }

    if (req.method === 'POST' && req.url === '/api/config') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { config: configStr } = JSON.parse(body);
                JSON.parse(configStr); // validate JSON
                const db = getDb();
                db.prepare(`
                    INSERT INTO app_config (id, data) VALUES (1, @data)
                    ON CONFLICT(id) DO UPDATE SET data = @data
                `).run({ data: configStr });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch(e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Invalid JSON or DB error: ' + e.message }));
            }
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/api/test-gemini') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { apiKey, model, endpoint } = JSON.parse(body);
                let baseUrl = (endpoint || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
                let modelName = model || 'gemini-1.5-flash';
                
                let response;
                // Check if it's an OpenAI-compatible endpoint (usually ends with /v1 or contains v1/chat)
                const isOpenAI = baseUrl.includes('/v1') && !baseUrl.includes('generativelanguage.googleapis.com');

                if (isOpenAI) {
                    const url = `${baseUrl}/chat/completions`;
                    console.log(`[AI Test] OpenAI Format - Calling: ${url}`);
                    response = await axios.post(url, {
                        model: modelName,
                        messages: [{ role: "user", content: "Hello, what is 1+1? Response only the number." }]
                    }, {
                        headers: { 
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        timeout: 10000
                    });
                } else {
                    // Google Gemini Native Format
                    let url;
                    const cleanModel = modelName.replace(/^models\//, '');
                    if (baseUrl.includes('/v1') || baseUrl.includes('/v1beta')) {
                        url = `${baseUrl}/models/${cleanModel}:generateContent?key=${apiKey}`;
                    } else {
                        url = `${baseUrl}/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;
                    }
                    console.log(`[AI Test] Gemini Format - Calling: ${url.replace(apiKey, 'REDACTED')}`);
                    response = await axios.post(url, {
                        contents: [{ parts: [{ text: "Hello, what is 1+1? Response only the number." }] }]
                    }, {
                        headers: { 'Content-Type': 'application/json' },
                        timeout: 10000
                    });
                }

                let reply = "";
                if (isOpenAI) {
                    reply = response.data?.choices?.[0]?.message?.content?.trim();
                } else {
                    reply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
                }
                
                reply = reply || "Connected successfully, but got empty response.";
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: `Connected! Answer: ${reply}` }));
            } catch (e) {
                console.error('[AI Test Error]:', e.response?.data || e.message);
                let errorMsg = e.message;
                if (e.response && e.response.data && e.response.data.error) {
                    const detail = e.response.data.error;
                    errorMsg = typeof detail === 'object' ? (detail.message || JSON.stringify(detail)) : detail;
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: errorMsg }));
            }
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/api/test-proxy') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const proxyInfo = JSON.parse(body);
                const rawUrl = proxyInfo.url || '';
                if (!rawUrl || !proxyInfo.port) {
                    throw new Error('Missing Proxy Host or Port');
                }
                const protoMatch = rawUrl.match(/^(https?|socks[45])/i);
                let proto = protoMatch ? protoMatch[1].toLowerCase() : 'http';
                const host = rawUrl.replace(/^(https?|socks[45])?:\/\//i, '');
                
                let proxyUrlStr = `${proto}://`;
                if (proxyInfo.username && proxyInfo.password) {
                    proxyUrlStr += `${encodeURIComponent(proxyInfo.username)}:${encodeURIComponent(proxyInfo.password)}@`;
                }
                proxyUrlStr += `${host}:${proxyInfo.port}`;

                let agent;
                if (proto.startsWith('socks')) {
                    const { SocksProxyAgent } = await import('socks-proxy-agent');
                    agent = new SocksProxyAgent(proxyUrlStr);
                } else {
                    const { HttpsProxyAgent } = await import('https-proxy-agent');
                    agent = new HttpsProxyAgent(proxyUrlStr);
                }

                const response = await axios.get('http://ip-api.com/json/', {
                    httpsAgent: agent,
                    httpAgent: agent,
                    timeout: 10000 
                });

                if (response.data && response.data.status === 'success') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        success: true, 
                        ip: response.data.query,
                        country: response.data.country,
                        city: response.data.city,
                        isp: response.data.isp
                    }));
                } else if (response.data && response.data.query) {
                    // Fallback if status is not success but query is there
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, ip: response.data.query }));
                } else {
                    throw new Error('Invalid response from IP service: ' + (response.data?.message || 'Unknown error'));
                }
            } catch (e) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/api/accounts/delete') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { email } = JSON.parse(body);
                const db = getDb();
                const result = db.prepare('DELETE FROM accounts WHERE email = ?').run(email);
                if (result.changes === 0) throw new Error('Account not found');
                // Xóa cả status
                db.prepare('DELETE FROM account_status WHERE email = ?').run(email);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch(e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/accounts/get')) {
        try {
            const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
            const email = urlParams.get('email');
            const db = getDb();
            const row = db?.prepare('SELECT * FROM accounts WHERE email = ?').get(email);
            if (!row) throw new Error('Account not found');
            const acc = {
                email:           row.email,
                password:        row.password,
                totpSecret:      row.totp_secret || undefined,
                recoveryEmail:   row.recovery_email,
                geoLocale:       row.geo_locale,
                langCode:        row.lang_code,
                proxy:           _safeParse(row.proxy, {}),
                saveFingerprint: _safeParse(row.save_fingerprint, { mobile: true, desktop: true }),
                group:           row.account_group || 'Ungrouped',
            };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, account: acc }));
        } catch(e) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: e.message }));
        }
        return;
    }

    if (req.method === 'POST' && req.url === '/api/accounts/update') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { originalEmail, account } = JSON.parse(body);
                const db = getDb();
                const now = Date.now();
                // Nếu email thay đổi: xóa cũ, thêm mới
                if (originalEmail !== account.email) {
                    db.prepare('DELETE FROM accounts WHERE email = ?').run(originalEmail);
                    // Chuyển status sang email mới
                    db.prepare('UPDATE account_status SET email = ? WHERE email = ?').run(account.email, originalEmail);
                }
                db.prepare(`
                    INSERT INTO accounts
                        (email, password, totp_secret, recovery_email, geo_locale, lang_code, proxy, save_fingerprint, account_group, created_at, updated_at)
                    VALUES
                        (@email, @password, @totpSecret, @recoveryEmail, @geoLocale, @langCode, @proxy, @saveFingerprint, @group, @now, @now)
                    ON CONFLICT(email) DO UPDATE SET
                        password         = @password,
                        totp_secret      = @totpSecret,
                        recovery_email   = @recoveryEmail,
                        geo_locale       = @geoLocale,
                        lang_code        = @langCode,
                        proxy            = @proxy,
                        save_fingerprint = @saveFingerprint,
                        account_group    = @group,
                        updated_at       = @now
                `).run({
                    email:           account.email,
                    password:        account.password        || '',
                    totpSecret:      account.totpSecret      || '',
                    recoveryEmail:   account.recoveryEmail   || '',
                    geoLocale:       account.geoLocale       || 'auto',
                    langCode:        account.langCode        || 'en',
                    proxy:           JSON.stringify(account.proxy           || {}),
                    saveFingerprint: JSON.stringify(account.saveFingerprint || { mobile: true, desktop: true }),
                    group:           account.group           || 'Ungrouped',
                    now,
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch(e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/api/accounts/add') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const newAcc = JSON.parse(body);
                if (!newAcc.email) throw new Error('Email is required');
                const db = getDb();
                const now = Date.now();
                db.prepare(`
                    INSERT INTO accounts
                        (email, password, totp_secret, recovery_email, geo_locale, lang_code, proxy, save_fingerprint, account_group, created_at, updated_at)
                    VALUES
                        (@email, @password, @totpSecret, @recoveryEmail, @geoLocale, @langCode, @proxy, @saveFingerprint, @group, @now, @now)
                `).run({
                    email:           newAcc.email,
                    password:        newAcc.password        || '',
                    totpSecret:      newAcc.totpSecret      || '',
                    recoveryEmail:   newAcc.recoveryEmail   || '',
                    geoLocale:       newAcc.geoLocale       || 'auto',
                    langCode:        newAcc.langCode        || 'en',
                    proxy:           JSON.stringify(newAcc.proxy           || {}),
                    saveFingerprint: JSON.stringify(newAcc.saveFingerprint || { mobile: true, desktop: true }),
                    group:           newAcc.group           || 'Ungrouped',
                    now,
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch(e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/api/accounts/bulk-update-group') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { emails, group } = JSON.parse(body);
                if (!Array.isArray(emails) || emails.length === 0) throw new Error('No emails provided');
                
                const db = getDb();
                const now = Date.now();
                const stmt = db.prepare('UPDATE accounts SET account_group = ?, updated_at = ? WHERE email = ?');
                
                db.transaction(() => {
                    for (const email of emails) {
                        stmt.run(group || 'Ungrouped', now, email);
                    }
                })();
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, count: emails.length }));
            } catch(e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    if (req.method === 'GET' && req.url === '/api/accounts/export') {
        try {
            const db = getDb();
            const accounts = db?.prepare('SELECT * FROM accounts ORDER BY created_at ASC').all() || [];
            
            const exportAccounts = accounts.map(row => ({
                email:           row.email,
                password:        row.password,
                totpSecret:      row.totp_secret || undefined,
                recoveryEmail:   row.recovery_email,
                geoLocale:       row.geo_locale,
                langCode:        row.lang_code,
                proxy:           _safeParse(row.proxy, {}),
                saveFingerprint: _safeParse(row.save_fingerprint, { mobile: true, desktop: true }),
                group:           row.account_group || 'Ungrouped',
            }));

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, accounts: exportAccounts }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: e.message }));
        }
        return;
    }

    if (req.method === 'POST' && req.url === '/api/accounts/import') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { accounts } = JSON.parse(body);
                if (!Array.isArray(accounts)) throw new Error('Accounts must be an array');
                const db = getDb();
                const now = Date.now();
                const insertStmt = db.prepare(`
                    INSERT INTO accounts
                        (email, password, totp_secret, recovery_email, geo_locale, lang_code, proxy, save_fingerprint, account_group, created_at, updated_at)
                    VALUES
                        (@email, @password, @totpSecret, @recoveryEmail, @geoLocale, @langCode, @proxy, @saveFingerprint, @group, @now, @now)
                    ON CONFLICT(email) DO UPDATE SET
                        password         = @password,
                        totp_secret      = @totpSecret,
                        recovery_email   = @recoveryEmail,
                        geo_locale       = @geoLocale,
                        lang_code        = @langCode,
                        proxy            = @proxy,
                        save_fingerprint = @saveFingerprint,
                        account_group    = @group,
                        updated_at       = @now
                `);
                
                db.transaction(() => {
                    for (const account of accounts) {
                        if (!account.email) continue;
                        insertStmt.run({
                            email:           account.email,
                            password:        account.password        || '',
                            totpSecret:      account.totpSecret      || '',
                            recoveryEmail:   account.recoveryEmail   || '',
                            geoLocale:       account.geoLocale       || 'auto',
                            langCode:        account.langCode        || 'en',
                            proxy:           JSON.stringify(account.proxy           || {}),
                            saveFingerprint: JSON.stringify(account.saveFingerprint || { mobile: true, desktop: true }),
                            group:           account.group           || 'Ungrouped',
                            now,
                        });
                    }
                })();

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, count: accounts.length }));
            } catch(e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    if (req.method === 'GET' && req.url === '/api/accounts') {
        try {
            const db = getDb();
            const accounts = db?.prepare('SELECT * FROM accounts ORDER BY created_at ASC').all() || [];
            const diskStatus = loadAccountStatus();
            
            const cleanAccounts = accounts.map(a => {
                const proxy = _safeParse(a.proxy, {});
                const isActiveDesktop = activeProcesses[`${a.email}-desktop`] !== undefined;
                const isActiveMobile  = activeProcesses[`${a.email}-mobile`]  !== undefined;
                const isActiveBot     = activeProcesses[`${a.email}-bot`]     !== undefined;

                let host = (proxy?.url || '').replace(/^(https?|socks[45]):\/\//i, '').toLowerCase().trim();
                let port = proxy?.port;
                if (host.includes(':')) {
                    const parts = host.split(':');
                    host = parts[0];
                    if (!port) port = parseInt(parts[1]);
                }
                const proxyStr = host ? `${host}:${port || 0}` : 'None';
                const proxyGroup = host
                    ? `${proxy?.username || ''}@${host}:${port || 0}`
                    : 'NO_PROXY';

                const ds = diskStatus[a.email] || null;
                let stats = accountStats[a.email] || null;
                if (!stats && ds) {
                    stats = {
                        total:       ds.collectedPoints ?? 0,
                        oldBalance:  ds.initialPoints   ?? 0,
                        newBalance:  ds.points          ?? 0,
                        duration:    ds.duration        ?? null,
                        rank:        ds.rank            || null,
                        completedAt: ds.lastUpdate      || null
                    };
                }

                return {
                    email: a.email,
                    proxy: proxyStr,
                    isProxyV6: !!proxy.isProxyV6,
                    group: a.account_group || 'Ungrouped',
                    proxyGroup,
                    isActiveDesktop,
                    isActiveMobile,
                    isActiveBot,
                    stats,
                    points:     ds?.points ?? 0,
                    rank:       accountStats[a.email]?.rank || ds?.rank || 'N/A',
                    lastUpdate: ds?.lastUpdate || 'Never'
                };
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, accounts: cleanAccounts }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: e.message }));
        }
        return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/logs')) {
        const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
        const email = urlParams.get('email');
        const type = urlParams.get('type');
        const key = `${email}-${type}`;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, logs: processLogs[key] || [] }));
        return;
    }

    if (req.method === 'POST' && req.url === '/api/open') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { email, type } = data; // type: 'desktop' | 'mobile' | 'bot'
                const key = `${email}-${type}`;

                if (activeProcesses[key]) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Session is already active' }));
                    return;
                }

                log('INFO', `Dashboard: Opening ${type} session for ${email}`);
                if (accountStats[email]) delete accountStats[email].isProxyBusy; 

                let args;
                if (type === 'bot') {
                    args = ['./dist/index.js', '-email', email];
                } else {
                    args = ['./scripts/main/browserSession.js', '-email', email, '-force'];
                    if (type === 'mobile') args.push('-mobile');
                }

                // Using spawn but attached tracking to update status on close
                const cp = spawn('node', args, { cwd: projectRoot });
                
                activeProcesses[key] = cp.pid;
                processLogs[key] = [];
                let lineBuffer = '';

                // Strip ANSI color/escape codes from log lines
                const stripAnsi = (str) => str.replace(/\x1b\[[0-9;]*m/g, '');

                const processLine = (line) => {
                    const clean = stripAnsi(line).trim();
                    if (!clean) return;
                    processLogs[key].push(clean);
                    if (type === 'bot') {
                        parseAccountEndLog(clean, email);
                        if (clean.includes('[PROXY-BUSY]')) {
                            if (!accountStats[email]) accountStats[email] = {};
                            accountStats[email].isProxyBusy = true;
                        }
                    }
                };

                const addLog = (data) => {
                    const str = data.toString();
                    process.stdout.write(str);

                    // Buffer-aware line splitting — handles partial chunks
                    lineBuffer += str;
                    const parts = lineBuffer.split('\n');
                    // All parts except the last are complete lines
                    for (let i = 0; i < parts.length - 1; i++) {
                        processLine(parts[i]);
                    }
                    // Last part is potentially incomplete — keep in buffer
                    lineBuffer = parts[parts.length - 1];

                    if (processLogs[key].length > 300) {
                        processLogs[key] = processLogs[key].slice(-300);
                    }
                };

                cp.stdout.on('data', addLog);
                cp.stderr.on('data', addLog);

                cp.on('exit', () => {
                    // Flush any remaining buffered content
                    if (lineBuffer.trim()) processLine(lineBuffer);
                    lineBuffer = '';
                    log('INFO', `Dashboard: Session closed for ${key}`);
                    delete activeProcesses[key];
                });


                cp.on('error', (err) => {
                    log('ERROR', `Dashboard: Error in ${key}: ${err.message}`);
                    delete activeProcesses[key];
                });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Process started', pid: cp.pid }));
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/api/stop') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { email, type } = data;
                const key = `${email}-${type}`;

                const pid = activeProcesses[key];
                if (pid) {
                    process.kill(pid);
                    delete activeProcesses[key];
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: 'Process stopped' }));
                } else {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Process not found or already closed' }));
                }
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

const PORT = 3000;
server.listen(PORT, () => {
    log('INFO', `Dashboard is running on http://localhost:${PORT}`);
    log('INFO', `Click here to open: http://localhost:${PORT}`);
});
