import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import Database from 'better-sqlite3'

export function getDirname(importMetaUrl) {
    const __filename = fileURLToPath(importMetaUrl)
    return path.dirname(__filename)
}

export function getProjectRoot(currentDir) {
    let dir = currentDir
    while (dir !== path.parse(dir).root) {
        if (fs.existsSync(path.join(dir, 'package.json'))) {
            return dir
        }
        dir = path.dirname(dir)
    }
    throw new Error('Could not find project root (package.json not found)')
}

export function log(level, ...args) {
    console.log(`[${level}]`, ...args)
}

export function parseArgs(argv = process.argv.slice(2)) {
    const args = {}

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]

        if (arg.startsWith('-')) {
            const key = arg.substring(1)

            if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
                args[key] = argv[i + 1]
                i++
            } else {
                args[key] = true
            }
        }
    }

    return args
}

export function validateEmail(email) {
    if (!email) {
        log('ERROR', 'Missing -email argument')
        log('ERROR', 'Usage: node script.js -email you@example.com')
        process.exit(1)
    }

    if (typeof email !== 'string') {
        log('ERROR', `Invalid email type: expected string, got ${typeof email}`)
        log('ERROR', 'Usage: node script.js -email you@example.com')
        process.exit(1)
    }

    if (!email.includes('@')) {
        log('ERROR', `Invalid email format: "${email}"`)
        log('ERROR', 'Email must contain "@" symbol')
        log('ERROR', 'Example: you@example.com')
        process.exit(1)
    }

    return email
}

export function loadJsonFile(possiblePaths, required = true) {
    for (const filePath of possiblePaths) {
        if (fs.existsSync(filePath)) {
            try {
                const content = fs.readFileSync(filePath, 'utf8')
                return { data: JSON.parse(content), path: filePath }
            } catch (error) {
                log('ERROR', `Failed to parse JSON file: ${filePath}`)
                log('ERROR', `Parse error: ${error.message}`)
                if (required) process.exit(1)
                return null
            }
        }
    }

    if (required) {
        log('ERROR', 'Required file not found')
        log('ERROR', 'Searched in the following locations:')
        possiblePaths.forEach(p => log('ERROR', `  - ${p}`))
        process.exit(1)
    }

    return null
}

function _safeParse(json, fallback) {
    try { return JSON.parse(json); } catch { return fallback; }
}

export function loadAccounts(projectRoot, isDev = false) {
    const dbPath = path.join(projectRoot, 'rewards_data.db');
    
    // 1. Try SQLite first
    try {
        if (fs.existsSync(dbPath)) {
            const db = new Database(dbPath, { readonly: true });
            const rows = db.prepare('SELECT * FROM accounts ORDER BY created_at ASC').all();
            db.close();
            
            if (rows.length > 0) {
                const accounts = rows.map(row => ({
                    email:          row.email,
                    password:        row.password,
                    totpSecret:      row.totp_secret || '',
                    recoveryEmail:   row.recovery_email || '',
                    geoLocale:       row.geo_locale || 'auto',
                    langCode:        row.lang_code || 'en',
                    proxy:           _safeParse(row.proxy, {}),
                    saveFingerprint: _safeParse(row.save_fingerprint, { mobile: true, desktop: true }),
                    group:           row.account_group || 'Ungrouped'
                }));
                return { data: accounts, path: dbPath };
            }
        }
    } catch (e) {
        log('WARN', `[DB] Could not read accounts: ${e.message} — trying JSON`);
    }

    // 2. Fallback: JSON
    const possiblePaths = isDev
        ? [path.join(projectRoot, 'src', 'accounts.dev.json')]
        : [
            path.join(projectRoot, 'accounts.json'),
            path.join(projectRoot, 'dist', 'accounts.json')
          ];
    
    return loadJsonFile(possiblePaths, true);
}

export function loadConfig(projectRoot, isDev = false) {
    // Ưu tiên đọc từ SQLite
    try {
        const dbPath = path.join(projectRoot, 'rewards_data.db');
        if (fs.existsSync(dbPath)) {
            const db = new Database(dbPath, { readonly: true });
            const row = db.prepare('SELECT data FROM app_config WHERE id = 1').get();
            db.close();
            if (row) {
                const config = JSON.parse(row.data);
                const missingFields = [];
                if (!config.baseURL)              missingFields.push('baseURL');
                if (!config.sessionPath)          missingFields.push('sessionPath');
                if (config.headless === undefined) missingFields.push('headless');
                if (!config.workers)              missingFields.push('workers');
                if (missingFields.length > 0) {
                    log('ERROR', 'Invalid config in DB — missing required fields:');
                    missingFields.forEach(f => log('ERROR', `  - ${f}`));
                    process.exit(1);
                }
                return { data: config, path: dbPath };
            }
        }
    } catch (e) {
        log('WARN', `[DB] Could not read config: ${e.message} — falling back to JSON`);
    }

    // Fallback: JSON (fresh install, DB chưa khởi tạo)
    const possiblePaths = isDev
        ? [path.join(projectRoot, 'src', 'config.json')]
        : [
            path.join(projectRoot, 'dist', 'config.json'),
            path.join(projectRoot, 'config.json')
        ];

    const result = loadJsonFile(possiblePaths, true);

    const missingFields = [];
    if (!result.data.baseURL)              missingFields.push('baseURL');
    if (!result.data.sessionPath)          missingFields.push('sessionPath');
    if (result.data.headless === undefined) missingFields.push('headless');
    if (!result.data.workers)             missingFields.push('workers');

    if (missingFields.length > 0) {
        log('ERROR', 'Invalid config.json — missing required fields:');
        missingFields.forEach(field => log('ERROR', `  - ${field}`));
        log('ERROR', `Config file: ${result.path}`);
        process.exit(1);
    }

    return result;
}

export function saveAccount(projectRoot, account, isDev = false) {
    const dbPath = path.join(projectRoot, 'rewards_data.db');
    const now = Date.now();

    // 1. Save to SQLite
    try {
        const db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        
        db.prepare(`
            INSERT INTO accounts
                (email, password, totp_secret, recovery_email, geo_locale, lang_code,
                 proxy, save_fingerprint, account_group, created_at, updated_at)
            VALUES
                (@email, @password, @totp_secret, @recovery_email, @geo_locale, @lang_code,
                 @proxy, @save_fingerprint, @account_group, @created_at, @updated_at)
            ON CONFLICT(email) DO UPDATE SET
                password         = @password,
                totp_secret      = @totp_secret,
                recovery_email   = @recovery_email,
                geo_locale       = @geo_locale,
                lang_code        = @lang_code,
                proxy            = @proxy,
                save_fingerprint = @save_fingerprint,
                account_group    = @account_group,
                updated_at       = @updated_at
        `).run({
            email: account.email,
            password: account.password || '',
            totp_secret: account.totpSecret || '',
            recovery_email: account.recoveryEmail || '',
            geo_locale: account.geoLocale || 'auto',
            lang_code: account.langCode || 'vi',
            proxy: JSON.stringify(account.proxy || {}),
            save_fingerprint: JSON.stringify(account.saveFingerprint || { mobile: true, desktop: true }),
            account_group: account.group || 'Ungrouped',
            created_at: now,
            updated_at: now
        });
        db.close();
        log('SUCCESS', `Account ${account.email} saved to database`);
    } catch (e) {
        log('ERROR', `Failed to save account to DB: ${e.message}`);
    }

    // 2. Save to JSON for fallback/backup
    const jsonPath = isDev
        ? path.join(projectRoot, 'src', 'accounts.dev.json')
        : (fs.existsSync(path.join(projectRoot, 'accounts.json')) 
            ? path.join(projectRoot, 'accounts.json')
            : path.join(projectRoot, 'dist', 'accounts.json'));

    try {
        let accounts = [];
        if (fs.existsSync(jsonPath)) {
            accounts = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        }
        
        const index = accounts.findIndex(a => a.email.toLowerCase() === account.email.toLowerCase());
        if (index !== -1) {
            accounts[index] = { ...accounts[index], ...account };
        } else {
            accounts.push(account);
        }
        
        fs.writeFileSync(jsonPath, JSON.stringify(accounts, null, 2));
        log('SUCCESS', `Account ${account.email} saved to ${path.basename(jsonPath)}`);
    } catch (e) {
        log('ERROR', `Failed to save account to JSON: ${e.message}`);
    }
}

export function findAccountByEmail(accounts, email) {
    if (!email || typeof email !== 'string') return null
    return accounts.find(a => a?.email && typeof a.email === 'string' && a.email.toLowerCase() === email.toLowerCase()) || null
}

export function getRuntimeBase(projectRoot, isDev = false) {
    return path.join(projectRoot, isDev ? 'src' : 'dist')
}

export function getSessionPath(runtimeBase, sessionPath, email) {
    return path.join(runtimeBase, 'browser', sessionPath, email)
}

export async function loadCookies(sessionBase, type = 'desktop') {
    const cookiesFile = path.join(sessionBase, `session_${type}.json`)

    if (!fs.existsSync(cookiesFile)) {
        return []
    }

    try {
        const content = await fs.promises.readFile(cookiesFile, 'utf8')
        return JSON.parse(content)
    } catch (error) {
        log('WARN', `Failed to load cookies from: ${cookiesFile}`)
        log('WARN', `Error: ${error.message}`)
        return []
    }
}

export async function saveCookies(sessionBase, cookies, type = 'desktop') {
    const cookiesFile = path.join(sessionBase, `session_${type}.json`)
    const sessionDir = path.dirname(cookiesFile)

    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true })
    }

    try {
        await fs.promises.writeFile(cookiesFile, JSON.stringify(cookies, null, 2))
        log('SUCCESS', `Cookies saved to: ${cookiesFile}`)
    } catch (error) {
        log('ERROR', `Failed to save cookies to: ${cookiesFile}`)
        log('ERROR', `Error: ${error.message}`)
    }
}

export async function loadFingerprint(sessionBase, type = 'desktop') {
    const fpFile = path.join(sessionBase, `session_fingerprint_${type}.json`)

    if (!fs.existsSync(fpFile)) {
        return null
    }

    try {
        const content = await fs.promises.readFile(fpFile, 'utf8')
        return JSON.parse(content)
    } catch (error) {
        log('WARN', `Failed to load fingerprint from: ${fpFile}`)
        log('WARN', `Error: ${error.message}`)
        return null
    }
}

export async function saveFingerprint(sessionBase, fingerprint, type = 'desktop') {
    const fpFile = path.join(sessionBase, `session_fingerprint_${type}.json`)
    const sessionDir = path.dirname(fpFile)

    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true })
    }

    try {
        await fs.promises.writeFile(fpFile, JSON.stringify(fingerprint, null, 2))
        log('SUCCESS', `Fingerprint saved to: ${fpFile}`)
    } catch (error) {
        log('ERROR', `Failed to save fingerprint to: ${fpFile}`)
        log('ERROR', `Error: ${error.message}`)
    }
}

export function getUserAgent(fingerprint) {
    if (!fingerprint) return null
    return fingerprint?.fingerprint?.userAgent || fingerprint?.userAgent || null
}

export function buildProxyConfig(account) {
    if (!account.proxy || !account.proxy.url || !account.proxy.port) {
        return null
    }

    let host = account.proxy.url.replace(/^(https?|socks[45]):\/\//i, '')
    const protocolMatch = account.proxy.url.match(/^(https?|socks[45])/i)
    let protocol = protocolMatch ? protocolMatch[1].toLowerCase() : 'http'

    // Xử lý địa chỉ IPv6 (phải bọc trong ngoặc vuông nếu chứa dấu : và chưa có ngoặc)
    if (host.includes(':') && !host.startsWith('[') && !host.includes('.')) {
        host = `[${host}]`
    }

    let bypassString = undefined
    if (account.proxy.isProxyV6) {
        const bypassFilePath = path.join(process.cwd(), 'bypass.txt')
        if (fs.existsSync(bypassFilePath)) {
            try {
                const bypassContent = fs.readFileSync(bypassFilePath, 'utf8').trim()
                if (bypassContent) bypassString = bypassContent
            } catch (e) {
                log('WARN', `Failed to read bypass.txt: ${e.message}`)
            }
        }
    }

    const proxy = {
        server: `${protocol}://${host}:${account.proxy.port}`
    }

    if (bypassString) {
        proxy.bypass = bypassString
    }

    if (account.proxy.username && account.proxy.password) {
        proxy.username = account.proxy.username
        proxy.password = account.proxy.password
    }

    return proxy
}

export function setupCleanupHandlers(cleanupFn) {
    const cleanup = async () => {
        try {
            await cleanupFn()
        } catch (error) {
            log('ERROR', 'Cleanup failed:', error.message)
        }
        process.exit(0)
    }

    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)
}

export function validateDeletionPath(targetPath, projectRoot) {
    const normalizedTarget = path.normalize(targetPath)
    const normalizedRoot = path.normalize(projectRoot)

    if (!normalizedTarget.startsWith(normalizedRoot)) {
        return {
            valid: false,
            error: 'Path is outside project root'
        }
    }

    if (normalizedTarget === normalizedRoot) {
        return {
            valid: false,
            error: 'Cannot delete project root'
        }
    }

    const pathSegments = normalizedTarget.split(path.sep)
    if (pathSegments.length < 3) {
        return {
            valid: false,
            error: 'Path is too shallow (safety check failed)'
        }
    }

    return { valid: true, error: null }
}

export function safeRemoveDirectory(dirPath, projectRoot) {
    const validation = validateDeletionPath(dirPath, projectRoot)

    if (!validation.valid) {
        log('ERROR', 'Directory deletion failed - safety check:')
        log('ERROR', `  Reason: ${validation.error}`)
        log('ERROR', `  Target: ${dirPath}`)
        log('ERROR', `  Project root: ${projectRoot}`)
        return false
    }

    if (!fs.existsSync(dirPath)) {
        log('INFO', `Directory does not exist: ${dirPath}`)
        return true
    }

    try {
        fs.rmSync(dirPath, { recursive: true, force: true })
        log('SUCCESS', `Directory removed: ${dirPath}`)
        return true
    } catch (error) {
        log('ERROR', `Failed to remove directory: ${dirPath}`)
        log('ERROR', `Error: ${error.message}`)
        return false
    }
}

export function getProxyKey(account) {
    if (!account || !account.proxy) {
        return 'NO_PROXY'
    }
    const p = account.proxy
    const rawUrl = p.url || p.server
    if (!rawUrl) {
        return 'NO_PROXY'
    }

    let host = rawUrl.replace(/^(https?|socks[45]):\/\//i, '').toLowerCase().trim()
    let port = p.port
    if (host.includes(':')) {
        const parts = host.split(':')
        if (parts[0]) host = parts[0]
        if (parts[1] && (!port || port === 0)) {
            const pVal = parseInt(parts[1])
            if (!isNaN(pVal)) port = pVal
        }
    }
    return `${p.username || ''}@${host}:${port || 0}`
}

export async function acquireProxyLock(proxyKey, projectRoot) {
    const lockDir = path.join(projectRoot || process.cwd(), '.locks')
    if (!fs.existsSync(lockDir)) {
        try { fs.mkdirSync(lockDir, { recursive: true }) } catch (e) { }
    }
    const safeKey = Buffer.from(proxyKey).toString('base64').replace(/[/+=]/g, '_')
    const lockPath = path.join(lockDir, `${safeKey}.lock`)

    const tryWrite = () => {
        try {
            fs.writeFileSync(lockPath, process.pid.toString(), { flag: 'wx' })
            return true
        } catch (err) {
            if (err.code === 'EEXIST') {
                try {
                    const content = fs.readFileSync(lockPath, 'utf8').trim()
                    if (!content) { 
                        try { fs.unlinkSync(lockPath) } catch(e){}
                        return "RETRY"
                    }
                    const pid = parseInt(content)
                    if (isNaN(pid)) { 
                        try { fs.unlinkSync(lockPath) } catch(e){}
                        return "RETRY"
                    }
                    try {
                        process.kill(pid, 0)
                        if (pid === process.pid) return true
                        return false // Truly alive
                    } catch (e) {
                        // PID dead
                        try { fs.unlinkSync(lockPath) } catch(e){}
                        return "RETRY"
                    }
                } catch (e) { return false }
            }
            return false
        }
    }

    let result = tryWrite()
    if (result === "RETRY") {
        result = tryWrite()
    }

    if (result === true) return { success: true }
    
    // If we failed, try to get the PID of the holder
    try {
        const content = fs.readFileSync(lockPath, 'utf8').trim()
        const pid = parseInt(content)
        return { success: false, pid: isNaN(pid) ? undefined : pid }
    } catch (e) {
        return { success: false }
    }
}

export function releaseProxyLock(proxyKey, projectRoot) {
    try {
        const safeKey = Buffer.from(proxyKey).toString('base64').replace(/[/+=]/g, '_')
        const lockPath = path.join(projectRoot || process.cwd(), '.locks', `${safeKey}.lock`)
        if (fs.existsSync(lockPath)) {
            const content = fs.readFileSync(lockPath, 'utf8').trim()
            if (parseInt(content) === process.pid) {
                try { fs.unlinkSync(lockPath) } catch(e){}
            }
        }
    } catch (e) { }
}