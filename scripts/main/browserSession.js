import fs from 'fs'
import { chromium } from 'patchright'
import { FingerprintGenerator } from 'fingerprint-generator'
import { newInjectedContext } from 'fingerprint-injector'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
import {
    getDirname,
    getProjectRoot,
    log,
    parseArgs,
    validateEmail,
    loadConfig,
    loadAccounts,
    findAccountByEmail,
    getRuntimeBase,
    getSessionPath,
    loadCookies,
    loadFingerprint,
    buildProxyConfig,
    setupCleanupHandlers
} from '../utils.js'

const __dirname = getDirname(import.meta.url)
const projectRoot = getProjectRoot(__dirname)

const args = parseArgs()
args.dev = args.dev || false

validateEmail(args.email)

const { data: config } = loadConfig(projectRoot, args.dev)
const { data: accounts } = loadAccounts(projectRoot, args.dev)

const account = findAccountByEmail(accounts, args.email)
if (!account) {
    log('ERROR', `Account not found: ${args.email}`)
    log('ERROR', 'Available accounts:')
    accounts.forEach(acc => {
        if (acc?.email) log('ERROR', `  - ${acc.email}`)
    })
    process.exit(1)
}

async function main() {
    const runtimeBase = getRuntimeBase(projectRoot, args.dev)
    const sessionBase = getSessionPath(runtimeBase, config.sessionPath, args.email)

    log('INFO', 'Validating session data...')

    if (!fs.existsSync(sessionBase)) {
        log('INFO', `Session directory does not exist. Creating new profile for: ${args.email}`)
        fs.mkdirSync(sessionBase, { recursive: true })
    }

    if (!config.baseURL) {
        log('ERROR', 'baseURL is not set in config.json')
        process.exit(1)
    }

    let sessionType = args.mobile ? 'mobile' : 'desktop'
    let cookies = await loadCookies(sessionBase, sessionType)

    if (cookies.length === 0 && !args.force) {
        const fallbackType = sessionType === 'desktop' ? 'mobile' : 'desktop'
        log('WARN', `No ${sessionType} session cookies found, checking ${fallbackType} session...`)
        const fallbackCookies = await loadCookies(sessionBase, fallbackType)

        if (fallbackCookies.length > 0) {
            log('INFO', `Found cookies in ${fallbackType} session, switching...`)
            cookies = fallbackCookies
            sessionType = fallbackType
        } else {
            log('INFO', 'No cookies found in either session. Starting fresh.')
            sessionType = args.mobile ? 'mobile' : 'desktop'
        }
    } else if (cookies.length === 0 && args.force) {
        log('INFO', `No existing ${sessionType} session found — starting fresh ${sessionType} profile.`)
    }

    if (cookies.length > 0) {
        log('INFO', `Using ${sessionType} session (${cookies.length} cookies)`)
    }

    const isMobile = sessionType === 'mobile'
    const fingerprintEnabled = isMobile ? account.saveFingerprint?.mobile : account.saveFingerprint?.desktop

    let fingerprint = null
    if (fingerprintEnabled) {
        fingerprint = await loadFingerprint(sessionBase, sessionType)
        if (!fingerprint) {
            log('INFO', `Fingerprint enabled but not found. Generating new ${sessionType} fingerprint...`)
            const fingerprintGenerator = new FingerprintGenerator()
            const browserType = config.browserType ?? 'chromium'
            const fingerprintBrowser = browserType === 'edge' ? 'edge' : 'chrome'
            const bOptions = {
                devices: isMobile ? ['mobile'] : ['desktop'],
                operatingSystems: isMobile ? ['android', 'ios'] : ['windows', 'macos', 'linux'],
                browsers: [fingerprintBrowser]
            }
            fingerprint = fingerprintGenerator.getFingerprint(bOptions)

            try {
                const { UserAgentManager } = require('../../dist/browser/UserAgent.js')
                const mockBot = {
                    config,
                    logger: { error: () => { }, warn: () => { }, info: () => { }, debug: () => { } }
                }
                const um = new UserAgentManager(mockBot)
                fingerprint = await um.updateFingerprintUserAgent(fingerprint, isMobile)
            } catch (err) {
                log('WARN', 'Could not apply exact Microsoft Edge UA string matching: ' + err.message)
            }

            fs.writeFileSync(
                `${sessionBase}/session_fingerprint_${sessionType}.json`,
                JSON.stringify(fingerprint, null, 2)
            )
            log('SUCCESS', `Generated and saved new ${sessionType} fingerprint`)
        } else {
            log('INFO', `Loaded ${sessionType} fingerprint`)
        }
    }

    const proxy = buildProxyConfig(account)

    if (proxy) {
        log('INFO', `  Proxy Config for Playwright: ${JSON.stringify(proxy)}`);
    }

    if (account.proxy && account.proxy.url && (!proxy || !proxy.server)) {
        log('ERROR', 'Proxy is configured in account but proxy data is invalid or incomplete')
        log('ERROR', 'Account proxy config:', JSON.stringify(account.proxy, null, 2))
        log('ERROR', 'Required fields: proxy.url, proxy.port')
        log('ERROR', 'Cannot start browser without proxy when it is explicitly configured')
        process.exit(1)
    }

    const userAgent = fingerprint?.fingerprint?.navigator?.userAgent || fingerprint?.fingerprint?.userAgent || null

    log('INFO', `Session: ${args.email} (${sessionType})`)
    log('INFO', `  Cookies: ${cookies.length}`)
    log('INFO', `  Fingerprint: ${fingerprint ? 'Yes' : 'No'}`)
    log('INFO', `  User-Agent: ${userAgent || 'Default'}`)
    log('INFO', `  Proxy: ${proxy ? 'Yes' : 'No'}`)
    log('INFO', 'Launching browser...')

    const browser = await chromium.launch({
        headless: false,
        ...(proxy ? { proxy } : {}),
        args: [
            '--no-sandbox',
            '--mute-audio',
            '--disable-setuid-sandbox',
            '--ignore-certificate-errors',
            '--ignore-certificate-errors-spki-list',
            '--ignore-ssl-errors',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-user-media-security=true',
            '--disable-blink-features=Attestation',
            '--disable-features=WebAuthentication,PasswordManagerOnboarding,PasswordManager,EnablePasswordsAccountStorage,Passkeys',
            '--disable-save-password-bubble'
        ]
    })

    let context
    if (fingerprint) {
        context = await newInjectedContext(browser, { fingerprint })

        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'credentials', {
                value: {
                    create: () => Promise.reject(new Error('WebAuthn disabled')),
                    get: () => Promise.reject(new Error('WebAuthn disabled'))
                }
            })
        })

        log('SUCCESS', 'Fingerprint injected into browser context')
    } else {
        context = await browser.newContext({
            viewport: isMobile ? { width: 375, height: 667 } : { width: 1366, height: 768 }
        })
    }

    if (cookies.length) {
        await context.addCookies(cookies)
        log('INFO', `Added ${cookies.length} cookies to context`)
    }

    const page = await context.newPage()
    await page.goto(config.baseURL, { waitUntil: 'domcontentloaded' })

    log('SUCCESS', 'Browser opened with session loaded')
    log('INFO', `Navigated to: ${config.baseURL}`)

    const saveCookies = async () => {
        if (context) {
            try {
                const newCookies = await context.cookies()
                fs.writeFileSync(
                    `${sessionBase}/session_${sessionType}.json`,
                    JSON.stringify(newCookies, null, 2)
                )
                log('INFO', `Saved ${newCookies.length} cookies on exit to ${sessionType} session`)
            } catch (e) {
                log('ERROR', `Failed to save cookies: ${e.message}`)
            }
        }
    }

    page.on('close', async () => {
        await saveCookies()
        log('INFO', 'Browser page closed. Exiting process...')
        process.exit(0)
    })

    browser.on('disconnected', async () => {
        await saveCookies()
        log('INFO', 'Browser disconnected. Exiting process...')
        process.exit(0)
    })

    setupCleanupHandlers(async () => {
        await saveCookies()
        if (browser?.isConnected?.()) {
            await browser.close()
        }
    })
}

main()