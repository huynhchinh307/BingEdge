import fs from 'fs'
import path from 'path'
import axios from 'axios'
import crypto from 'crypto'
import { chromium } from 'patchright'
import { newInjectedContext } from 'fingerprint-injector'
import { FingerprintGenerator } from 'fingerprint-generator'
import {
    getDirname,
    getProjectRoot,
    log,
    parseArgs,
    loadConfig,
    saveAccount,
    setupCleanupHandlers,
    saveCookies,
    saveFingerprint,
    getRuntimeBase,
    getSessionPath,
    getProxyKey,
    acquireProxyLock,
    releaseProxyLock
} from '../utils.js'

const __dirname = getDirname(import.meta.url)
const projectRoot = getProjectRoot(__dirname)

const args = parseArgs()
const { data: config, path: configPath } = loadConfig(projectRoot, args.dev || false)

// --- Persistence logic for new config fields ---
if ((args.rotationUrl && !config.proxyRotationUrl) || (args.otpKey && !config.apiOtpKey)) {
    try {
        const Database = (await import('better-sqlite3')).default
        const dbPath = path.join(projectRoot, 'rewards_data.db')
        const db = new Database(dbPath)

        const newConfig = { ...config }
        if (args.rotationUrl) newConfig.proxyRotationUrl = args.rotationUrl
        if (args.otpKey) newConfig.apiOtpKey = args.otpKey

        db.prepare('UPDATE app_config SET data = ? WHERE id = 1').run(JSON.stringify(newConfig, null, 2))
        db.close()
        log('SUCCESS', 'Updated dashboard config with provided API keys/URLs')
    } catch (e) {
        log('WARN', `Could not auto-save config: ${e.message}`)
    }
}
// ----------------------------------------------

// --- Helper Functions ---

async function rotateProxy(url) {
    if (!url) return null
    try {
        log('INFO', 'Rotating proxy...')
        const response = await axios.get(url)
        // Handle both "status: success" and "success: true" formats
        if (response.data.status === 'success' || response.data.success === true) {
            const proxyStr = response.data.proxy // format: "ip:port:user:pass"

            if (proxyStr) {
                const parts = proxyStr.split(':')
                log('SUCCESS', `Proxy Rotated: ${parts[0]}:${parts[1]} | IP: ${response.data.ip || 'Unknown'}`)
                return {
                    server: `http://${parts[0]}:${parts[1]}`,
                    host: parts[0],
                    port: parts[1],
                    username: parts[2],
                    password: parts[3],
                    isProxyV6: (response.data.ip && response.data.ip.includes(':')) || parts[0].includes(':')
                }
            } else {
                log('SUCCESS', 'Proxy rotation triggered successfully (Static Proxy)')
                return { triggerOnly: true }
            }
        } else {
            log('ERROR', `Proxy rotation failed: ${response.data.message || response.data.msg || 'Unknown error'}`)
        }
    } catch (e) {
        log('ERROR', `Proxy rotation failed: ${e.message}`)
    }
    return null
}

async function createOtpOrder(apiKey, retries = 5) {
    if (!apiKey) return null
    for (let i = 0; i < retries; i++) {
        try {
            log('INFO', `Renting Gmail for OTP... (Attempt ${i + 1}/${retries})`)
            const response = await axios.get(`https://api.shopgmail9999.com/api/ApiV2/CreateOrder?apikey=${apiKey}&service=microsoft`)
            if (response.data.status === 'success') {
                return response.data.data // { email, orderid, ... }
            } else {
                log('WARN', `OTP Order failed: ${response.data.msg}. Retrying in 15s...`)
            }
        } catch (e) {
            const errorMsg = e.response?.data?.msg || e.message
            log('ERROR', `OTP Order error (400?): ${errorMsg}. Retrying in 15s...`)
        }
        if (i < retries - 1) await new Promise(r => setTimeout(r, 15000))
    }
    return null
}

async function checkOtp(apiKey, orderId) {
    try {
        const response = await axios.get(`https://api.shopgmail9999.com/api/ApiV2/CheckOtp?apikey=${apiKey}&orderid=${orderId}`)
        if (response.data.status === 'success' && response.data.data.otp) {
            return response.data.data.otp
        }
    } catch (e) {
        // Silent error for polling
    }
    return null
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
}

function generateRandomPassword(length = 12) {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*'
    let password = ''
    // Ensure at least one of each required type
    password += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[getRandomInt(0, 25)]
    password += 'abcdefghijklmnopqrstuvwxyz'[getRandomInt(0, 25)]
    password += '0123456789'[getRandomInt(0, 9)]
    password += '!@#$%^&*'[getRandomInt(0, 7)]

    for (let i = 4; i < length; i++) {
        password += charset[getRandomInt(0, charset.length - 1)]
    }
    return password.split('').sort(() => 0.5 - Math.random()).join('')
}

async function humanType(page, selector, text) {
    const element = typeof selector === 'string' ? page.locator(selector).first() : selector
    await element.focus()
    await page.waitForTimeout(getRandomInt(300, 800)) // Human-like pause after focus
    for (const char of text) {
        // Variable typing speed with occasional longer pauses
        const delay = getRandomInt(100, 250)
        await page.keyboard.type(char, { delay })
        if (Math.random() > 0.9) await page.waitForTimeout(getRandomInt(150, 400))
    }
    await page.waitForTimeout(getRandomInt(400, 1000)) // Pause after typing
}

async function fluentUIClick(page, selector) {
    const element = typeof selector === 'string' ? page.locator(selector).first() : selector
    await element.scrollIntoViewIfNeeded()
    await page.waitForTimeout(getRandomInt(200, 500))
    await element.focus()
    await page.waitForTimeout(getRandomInt(600, 1500)) // Human-like thinking time

    // Attempt a real click first, as it's more human
    try {
        await element.click({ delay: getRandomInt(50, 150) })
    } catch (e) {
        // Fallback to Enter if click fails (Fluent UI quirk)
        await page.keyboard.press('Enter')
    }
    await page.waitForTimeout(getRandomInt(1000, 2000)) // Wait for UI transition
}

async function waitForPageStable(page, timeout = 10000) {
    try {
        await page.waitForLoadState('networkidle', { timeout })
        // Safe wait for common loading indicators
        await page.waitForFunction(() => !document.querySelector('.loading, .spinner, .fui-Spinner'), { timeout: 5000 }).catch(() => { })
    } catch (e) { }
}

async function getIpLocation(proxy) {
    const isNoProxy = !proxy || !proxy.server
    const hostPart = isNoProxy ? '' : proxy.server.replace(/^(https?|socks[45]):\/\//i, '').split(':')[0]
    const isV6 = !isNoProxy && (proxy.isProxyV6 || hostPart.includes('[') || (hostPart.includes(':') && !hostPart.includes('.')))

    if (isV6) {
        log('INFO', 'IPv6 Proxy detected. Location sync might be slow or fail.')
    }

    const services = [
        'http://api64.ipify.org?format=json',
        'http://ip.nf/me.json',
        'http://ip-api.com/json',
        'https://ipinfo.io/json'
    ]

    try {
        let axiosAgent = null
        if (!isNoProxy) {
            log('INFO', 'Syncing location and timezone with Proxy IP...')
            const { HttpsProxyAgent } = await import('https-proxy-agent')
            const { HttpProxyAgent } = await import('http-proxy-agent')
            const { SocksProxyAgent } = await import('socks-proxy-agent')

            const serverUrl = proxy.server.includes('://') ? proxy.server : `http://${proxy.server}`
            const urlObj = new URL(serverUrl)

            let proxyUrl = serverUrl
            if (proxy.username && proxy.password) {
                proxyUrl = `${urlObj.protocol}//${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@${urlObj.host}`
            }

            if (urlObj.protocol === 'socks4:' || urlObj.protocol === 'socks5:') {
                axiosAgent = new SocksProxyAgent(proxyUrl)
            } else if (urlObj.protocol === 'https:') {
                axiosAgent = new HttpsProxyAgent(proxyUrl)
            } else {
                axiosAgent = new HttpProxyAgent(proxyUrl)
            }
        } else {
            log('INFO', 'Syncing location and timezone with Direct IP...')
        }

        for (const url of services) {
            try {
                const response = await axios.get(url, {
                    httpsAgent: axiosAgent,
                    httpAgent: axiosAgent,
                    timeout: isV6 ? 20000 : 12000
                })

                if (response.data) {
                    const d = response.data
                    // Normalize different API responses
                    const data = {
                        city: d.city || '',
                        country: d.country || d.country_name || '',
                        timezone: d.timezone || d.ip?.timezone || 'UTC',
                        lat: parseFloat(d.lat || d.latitude || d.ip?.latitude || 0),
                        lon: parseFloat(d.lon || d.longitude || d.ip?.longitude || 0)
                    }

                    if (data.lat !== 0 || data.timezone !== 'UTC') {
                        log('SUCCESS', `Location: ${data.city}, ${data.country} | Timezone: ${data.timezone} (via ${new URL(url).hostname})`)
                        return data
                    }
                }
            } catch (e) {
                const status = e.response?.status
                log('WARN', `IP API (${new URL(url).hostname}) failed: ${e.message}${status ? ` (Status: ${status})` : ''}`)
                continue
            }
        }
    } catch (e) {
        log('ERROR', `Critical Error in getIpLocation: ${e.message}`)
    }

    if (isV6 || isNoProxy) {
        log('WARN', 'Could not sync location. Using default system timezone/location.')
        return null
    }

    log('ERROR', 'All IP Location services failed or returned 502. Stopping flow to prevent IP leak.')
    process.exit(1)
    return null
}


async function main() {
    log('INFO', 'Starting Fully Automated Account Registration...')
    let proxyKey = 'NO_PROXY'

    // 1. Proxy Selection (Rotation -> Global Fallback -> Direct)
    let effectiveProxy = null
    const rotatedProxy = await rotateProxy(config.proxyRotationUrl || args.rotationUrl)
    const globalProxy = config.proxy

    if (rotatedProxy) {
        if (rotatedProxy.triggerOnly) {
            // Static proxy: rotation triggered via URL, use Global Proxy for connection details
            if (globalProxy && globalProxy.enable && globalProxy.url) {
                effectiveProxy = {
                    server: `http://${globalProxy.url}:${globalProxy.port}`,
                    host: globalProxy.url,
                    port: globalProxy.port,
                    username: globalProxy.username || undefined,
                    password: globalProxy.password || undefined,
                    isProxyV6: false
                }
            } else {
                log('WARN', 'Proxy rotation triggered but Global Proxy settings are missing. Using direct connection!')
            }
        } else {
            effectiveProxy = rotatedProxy
        }
    } else {
        if (config.proxyRotationUrl || args.rotationUrl) {
            log('ERROR', 'Could not rotate proxy or rotation failed. Checking Global Fallback...')
        }

        if (globalProxy && globalProxy.enable && globalProxy.url) {
            log('INFO', 'Using Global Proxy defined in configuration...')
            effectiveProxy = {
                server: `http://${globalProxy.url}:${globalProxy.port}`,
                host: globalProxy.url,
                port: globalProxy.port,
                username: globalProxy.username || undefined,
                password: globalProxy.password || undefined,
                isProxyV6: false
            }
        }
    }

    if (effectiveProxy) {
        log('INFO', `Effective Proxy: ${effectiveProxy.host}:${effectiveProxy.port}${effectiveProxy.username ? ` (Auth: ${effectiveProxy.username})` : ' (No Auth)'}`)
    } else {
        log('WARN', 'No proxy in use. Running with Direct IP!')
    }

    proxyKey = getProxyKey({ proxy: effectiveProxy })
    const lock = await acquireProxyLock(proxyKey, projectRoot)
    if (!lock.success) {
        log('ERROR', `Proxy ${proxyKey === 'NO_PROXY' ? 'No-Proxy' : proxyKey} is currently in use (PID: ${lock.pid || 'Unknown'}).`)
        log('ERROR', 'Please close the other session or use the "Clear Locks" button on the Dashboard.')
        process.exit(88)
    }

    // 2. Order OTP
    const otpKey = config.apiOtpKey || args.otpKey
    const order = await createOtpOrder(otpKey)
    if (!order) {
        log('ERROR', 'Could not rent email. Check config.apiOtpKey')
        process.exit(1)
    }

    const email = order.email
    const orderId = order.orderid
    const password = args.password || generateRandomPassword(14)

    log('SUCCESS', `Rented Email: ${email} | Order ID: ${orderId} | Password: ${password}`)

    const runtimeBase = getRuntimeBase(projectRoot, args.dev || false)
    const sessionBase = getSessionPath(runtimeBase, config.sessionPath || 'sessions', email)

    // Save initial account info early (so we don't lose the password if things fail later)
    const initialAccount = {
        email,
        password,
        recoveryEmail: '',
        proxy: effectiveProxy ? {
            url: `http://${effectiveProxy.host}`,
            port: effectiveProxy.port,
            username: effectiveProxy.username,
            password: effectiveProxy.password
        } : {},
        geoLocale: 'auto',
        langCode: 'vi',
        group: 'Hanoi',
        saveFingerprint: { mobile: true, desktop: true }
    }
    saveAccount(projectRoot, initialAccount, args.dev || false)

    // 3. Launch Browser
    const BROWSER_ARGS = [
        '--no-sandbox',
        '--mute-audio',
        '--disable-setuid-sandbox',
        '--ignore-certificate-errors',
        '--ignore-certificate-errors-spki-list',
        '--ignore-ssl-errors',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-web-authentication-ui',
        '--disable-external-intent-requests',
        '--disable-blink-features=Attestation',
        '--disable-features=WebAuthentication,PasswordManagerOnboarding,PasswordManager,EnablePasswordsAccountStorage,Passkeys,WebAuthenticationProxy,U2F',
        '--disable-save-password-bubble',
        '--window-size=1920,1080'
    ]

    const browser = await chromium.launch({
        headless: false,
        proxy: effectiveProxy || undefined,
        args: [...BROWSER_ARGS]
    })

    // --- New logic: Save and exit immediately when browser is closed ---
    browser.on('disconnected', async () => {
        await persistSessionData()
        log('INFO', 'Browser closed. Process ended.')
        process.exit(0)
    })
    // ------------------------------------------------------------------

    let fingerprint = null
    const browserType = config.browserType ?? 'chromium'
    const fingerprintBrowser = browserType === 'edge' ? 'edge' : 'chrome'

    const fingerprintGenerator = new FingerprintGenerator()
    fingerprint = fingerprintGenerator.getFingerprint({
        devices: ['desktop'],
        operatingSystems: ['windows', 'macos', 'linux'],
        browsers: [fingerprintBrowser],
        screen: {
            minWidth: 1366,
            maxWidth: 1920,
            minHeight: 768,
            maxHeight: 1080
        }
    })

    try {
        const { UserAgentManager } = await import('../../dist/browser/UserAgent.js')
        const mockBot = {
            config,
            logger: { error: () => { }, warn: () => { }, info: () => { }, debug: () => { } }
        }
        const um = new UserAgentManager(mockBot)
        fingerprint = await um.updateFingerprintUserAgent(fingerprint, false) // false = desktop
        log('SUCCESS', 'Applied exact Edge/Chrome UA string matching')
    } catch (err) {
        log('WARN', 'Could not apply exact UA string matching: ' + err.message)
    }

    let isSaved = false
    let currentContext = null
    let currentFingerprint = null

    async function persistSessionData(silent = false) {
        if (isSaved || !currentContext) return

        // If browser is already closed, we can't get cookies anymore. 
        // We should have saved them periodically before this.
        if (!browser.isConnected()) {
            if (!silent) log('WARN', 'Browser already closed, using last saved session data.')
            isSaved = true
            return
        }

        try {
            if (!silent) log('INFO', 'Capturing cookies and fingerprint for persistence...')
            const cookies = await currentContext.cookies()
            await saveCookies(sessionBase, cookies, 'desktop')
            await saveFingerprint(sessionBase, currentFingerprint, 'desktop')

            // Note: Don't set isSaved = true if we are doing periodic saves
            if (silent) {
                // Just update files silently
            } else {
                isSaved = true
                log('SUCCESS', `Session persistence completed for ${email}`)
            }
        } catch (e) {
            if (!silent) log('WARN', `Persistence failed (maybe already closed): ${e.message}`)
        }
    }

    const ipLocation = await getIpLocation(effectiveProxy)
    const locale = (args.geo || 'US').toLowerCase() === 'vi' ? 'vi-VN' : 'en-US'

    const context = await newInjectedContext(browser, {
        fingerprint,
        newContextOptions: {
            viewport: { width: getRandomInt(1366, 1920), height: getRandomInt(768, 1080) },
            locale: locale,
            timezoneId: ipLocation?.timezone,
            geolocation: ipLocation ? { latitude: ipLocation.lat, longitude: ipLocation.lon } : undefined,
            permissions: ['geolocation'],
            ignoreHTTPSErrors: true,
            bypassCSP: true
        }
    })

    // Add Human-like scripts & mocks (Matching index.ts/Browser.ts/browserSession.js)
    if (ipLocation) {
        await context.addInitScript((locationData) => {
            const mockGeo = {
                getCurrentPosition: (success) => {
                    success({
                        coords: {
                            latitude: locationData.latitude,
                            longitude: locationData.longitude,
                            accuracy: 100,
                            altitude: null,
                            altitudeAccuracy: null,
                            heading: null,
                            speed: null,
                        },
                        timestamp: Date.now(),
                    });
                },
                watchPosition: (success) => {
                    success({
                        coords: {
                            latitude: locationData.latitude,
                            longitude: locationData.longitude,
                            accuracy: 100,
                            altitude: null,
                            altitudeAccuracy: null,
                            heading: null,
                            speed: null,
                        },
                        timestamp: Date.now(),
                    });
                    return 1337;
                },
                clearWatch: () => { },
            };

            // Overwrite navigator.geolocation
            Object.defineProperty(navigator, 'geolocation', {
                value: mockGeo,
                configurable: true,
                enumerable: true,
                writable: true
            });

            // Disable Credentials (WebAuthn)
            Object.defineProperty(navigator, 'credentials', {
                value: {
                    create: () => Promise.reject(new Error('WebAuthn disabled')),
                    get: () => Promise.reject(new Error('WebAuthn disabled'))
                }
            })
        }, { latitude: ipLocation.lat, longitude: ipLocation.lon })
    }

    // Grant permissions explicitly for common domains (Matching browserSession.js)
    await context.grantPermissions(['geolocation'], { origin: 'https://rewards.bing.com' })
    await context.grantPermissions(['geolocation'], { origin: 'https://www.bing.com' })
    await context.grantPermissions(['geolocation'], { origin: 'https://microsoft.com' })
    await context.grantPermissions(['geolocation'], { origin: 'https://rewards.microsoft.com' })
    await context.grantPermissions(['geolocation'], { origin: 'https://signup.live.com' })
    currentContext = context
    currentFingerprint = fingerprint

    // Auto-save if browser or context closes
    context.on('close', () => persistSessionData())

    const page = await context.newPage()

    try {
        log('INFO', 'Navigating to signup...')
        await page.goto('https://signup.live.com/signup', { waitUntil: 'networkidle', timeout: 60000 })

        // 4. Fill Information
        log('INFO', `Entering Email: ${email}`)
        await page.waitForSelector('input[type="email"]', { state: 'visible' })
        await humanType(page, 'input[type="email"]', email)
        await page.waitForTimeout(getRandomInt(1000, 2000))
        await fluentUIClick(page, 'input[type="submit"], button[type="submit"], #nextbutton')

        await waitForPageStable(page)

        // 5. Poll for OTP
        log('INFO', 'Waiting for OTP...')
        let otp = null
        for (let i = 0; i < 30; i++) { // wait 5 minutes max
            otp = await checkOtp(otpKey, orderId)
            if (otp) {
                log('SUCCESS', `Received OTP: ${otp}`)
                break
            }
            log('INFO', `Polling OTP... (Attempt ${i + 1}/30)`)
            await new Promise(r => setTimeout(r, 10000))
        }

        if (!otp) {
            log('ERROR', 'OTP Timeout. Closing...')
            process.exit(1)
        }

        // Check for standard input or multi-digit inputs (codeEntry-0...5)
        const isSplitInput = await page.$('#codeEntry-0')
        if (isSplitInput) {
            log('INFO', 'Entering split OTP digits...')
            for (let i = 0; i < otp.length; i++) {
                const selector = `#codeEntry-${i}`
                const input = await page.$(selector)
                if (input) {
                    await input.focus()
                    await page.keyboard.type(otp[i], { delay: getRandomInt(50, 150) })
                }
            }
        } else {
            await page.waitForSelector('input[name="VerificationCode"], input[data-testid="codeEntry"]', { state: 'visible' })
            await humanType(page, 'input[name="VerificationCode"]', otp)
        }

        // Click next/submit
        const submitSelector = 'input[type="submit"], button[type="submit"], #nextbutton'
        await fluentUIClick(page, submitSelector)
        await waitForPageStable(page)
        await page.waitForTimeout(getRandomInt(3000, 5000))
        // 6. Birth Date (Custom Dropdowns)
        log('INFO', 'Filling Birth Date...')
        await page.waitForSelector('[data-testid="birthdateControls"], #BirthMonthDropdown', { state: 'visible' })

        const day = String(getRandomInt(1, 25)) // Avoid 29-31 for safety
        const monthIndex = getRandomInt(1, 12)
        const year = String(getRandomInt(1995, 2005)) // Sinh năm > 1994

        const months = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ]
        const monthName = months[monthIndex - 1]

        // 1. Month
        await fluentUIClick(page, '#BirthMonthDropdown')
        await page.waitForSelector('div[role="listbox"], .fui-Listbox', { state: 'visible' })
        await page.locator('role=option').filter({ hasText: monthName }).first().click()
        await page.waitForTimeout(getRandomInt(1000, 2000))

        // 2. Day
        await fluentUIClick(page, '#BirthDayDropdown')
        await page.waitForSelector('div[role="listbox"], .fui-Listbox', { state: 'visible' })
        await page.locator('role=option').filter({ hasText: day }).first().click()
        await page.waitForTimeout(getRandomInt(1000, 2000))

        // 3. Year
        await humanType(page, 'input[name="BirthYear"]', year)
        await page.waitForTimeout(getRandomInt(1000, 2000))

        await fluentUIClick(page, submitSelector)
        await waitForPageStable(page)
        await page.waitForTimeout(getRandomInt(3000, 5000))
        // 8. Name - Vietnamese + English Random (Expanded List)
        const lastNames = [
            // Phổ biến nhất (VN)
            'Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng',
            'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý', 'Lưu', 'Trương', 'Đinh', 'Cao',
            // Khá phổ biến (VN)
            'Phùng', 'Chu', 'Trịnh', 'Quách', 'Đào', 'Hà', 'Tạ', 'Lương', 'Mai', 'Liễu',
            'Lục', 'Lâm', 'Đoàn', 'Kiều', 'Thái', 'Vương', 'Tống', 'Tô', 'Từ', 'Mạc',
            'Châu', 'Phó', 'Hứa', 'Nghiêm', 'Âu', 'Diệp', 'Sầm', 'Giáp', 'Thân', 'Thạch',
            // Ít phổ biến hơn (VN)
            'Nông', 'Vi', 'Đoàn', 'Lã', 'Đới', 'Chiêu', 'Vương', 'Ông', 'Bạch', 'La',
            'Văn', 'Kim', 'Đường', 'Tề', 'Khuất', 'Tưởng', 'Đồng', 'Khổng', 'Trang', 'Biên',
            'Chung', 'Cái', 'Lại', 'Mã', 'Liêu', 'Trịnh', 'Hình', 'Hoa', 'Triệu', 'Thẩm',
            // English / Western
            'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
            'Rodriguez', 'Martinez', 'Taylor', 'Anderson', 'Thomas', 'Jackson', 'White',
            'Harris', 'Martin', 'Thompson', 'Robinson', 'Clark', 'Lewis', 'Lee', 'Walker',
            'Hall', 'Allen', 'Young', 'Hernandez', 'King', 'Wright', 'Lopez', 'Hill', 'Scott',
            'Green', 'Adams', 'Baker', 'Gonzalez', 'Nelson', 'Carter', 'Mitchell', 'Perez',
            'Roberts', 'Turner', 'Phillips', 'Campbell', 'Parker', 'Evans', 'Edwards', 'Collins',
            'Stewart', 'Sanchez', 'Morris', 'Rogers', 'Reed', 'Cook', 'Morgan', 'Bell', 'Murphy',
            'Bailey', 'Rivera', 'Cooper', 'Richardson', 'Cox', 'Howard', 'Ward', 'Torres', 'Peterson',
            'Gray', 'Ramirez', 'James', 'Watson', 'Brooks', 'Kelly', 'Sanders', 'Price', 'Bennett',
            'Wood', 'Barnes', 'Ross', 'Henderson', 'Coleman', 'Jenkins', 'Perry', 'Powell', 'Long',
            'Patterson', 'Hughes', 'Flores', 'Washington', 'Butler', 'Simmons', 'Foster', 'Gonzales',
            'Bryant', 'Alexander', 'Russell', 'Griffin', 'Diaz', 'Hayes'
        ]

        // Tên đệm
        const middleNames = [
            // VN
            'Thị', 'Văn', 'Đức', 'Thành', 'Minh', 'Quang', 'Anh', 'Bảo', 'Hữu', 'Công',
            'Ngọc', 'Tiến', 'Phước', 'Thế', 'Trung', 'Xuân', 'Như', 'Mỹ', 'Thanh', 'Tấn',
            'Phú', 'Gia', 'Hồng', 'Khắc', 'Nhật', 'Trọng', 'Hoài', 'Bích', 'Kim', 'Tú',
            'Đình', 'Xuân', 'Hoàng', 'Kiều', 'Tuấn', 'Nhã', 'Đan', 'Thủy', 'Hải', 'Song',
            // EN
            'Alan', 'Edward', 'Rose', 'Grace', 'Lee', 'Ray', 'Lynn', 'Marie', 'Ann', 'Jane',
            'Joseph', 'Charles', 'Thomas', 'Alexander', 'William', 'James', 'Arthur', 'David',
            'Elizabeth', 'Claire', 'Louise', 'Victoria', 'Mae', 'Renee', 'Kate', 'Faith'
        ]

        // Tên chính đa dạng (nam + nữ)
        const givenNamesMale = [
            // VN
            'Hùng', 'Dũng', 'Tuấn', 'Minh', 'Nam', 'Phong', 'Sơn', 'Quân', 'Huy', 'Long',
            'Vinh', 'Đạt', 'Cường', 'Hiếu', 'Nghĩa', 'Khôi', 'Bình', 'Thịnh', 'Tiến', 'Tài',
            'Quang', 'Quốc', 'Thắng', 'Khải', 'Sang', 'Trung', 'Tú', 'Việt', 'Hải', 'Thành',
            'Duy', 'Bảo', 'Đức', 'Nhân', 'Trọng', 'Khánh', 'Tâm', 'Hòa', 'Thạch', 'Tấn',
            'Phúc', 'Gia', 'Khoa', 'Lộc', 'Phước', 'Thế', 'Nhật', 'Quý', 'Hậu', 'Thiện',
            'Lâm', 'Cẩm', 'Đăng', 'Mạnh', 'Vũ', 'Tín', 'Nhân', 'Hào', 'Kiên', 'Lực',
            'Dương', 'Hưng', 'Toàn', 'Tùng', 'Quân', 'Trí', 'Tùng', 'Đạo', 'Nguyên', 'Hào',
            'Phát', 'Khang', 'Đại', 'Chính', 'Bằng', 'Doanh', 'Quyết', 'Thái', 'Kỷ', 'Sỹ',
            // EN
            'James', 'Robert', 'John', 'Michael', 'David', 'William', 'Richard', 'Joseph',
            'Thomas', 'Charles', 'Christopher', 'Daniel', 'Matthew', 'Anthony', 'Mark', 'Donald',
            'Steven', 'Paul', 'Andrew', 'Joshua', 'Kenneth', 'Kevin', 'Brian', 'George', 'Timothy',
            'Ronald', 'Edward', 'Jason', 'Jeffrey', 'Ryan', 'Jacob', 'Gary', 'Nicholas', 'Eric',
            'Jonathan', 'Stephen', 'Larry', 'Justin', 'Scott', 'Brandon', 'Benjamin', 'Samuel',
            'Gregory', 'Alexander', 'Frank', 'Patrick', 'Raymond', 'Jack', 'Dennis', 'Jerry',
            'Tyler', 'Aaron', 'Jose', 'Adam', 'Henry', 'Nathan', 'Douglas', 'Zachary', 'Peter',
            'Kyle', 'Walter', 'Ethan', 'Jeremy', 'Harold', 'Keith', 'Christian', 'Roger', 'Noah',
            'Gerald', 'Carl', 'Terry', 'Sean', 'Austin', 'Arthur', 'Lawrence', 'Jesse', 'Dylan',
            'Bryan', 'Joe', 'Jordan', 'Billy', 'Bruce', 'Albert', 'Willie', 'Gabriel', 'Logan',
            'Alan', 'Juan', 'Wayne', 'Ralph', 'Roy', 'Eugene', 'Randy', 'Vincent', 'Russell',
            'Louis', 'Philip', 'Bobby', 'Johnny', 'Bradley'
        ]
        const givenNamesFemale = [
            // VN
            'Linh', 'Hương', 'Ngọc', 'Thảo', 'Lan', 'Oanh', 'Phương', 'Hạnh', 'Tuyết', 'Yên',
            'My', 'Ngân', 'Uyên', 'Vy', 'Xuân', 'Trâm', 'Diệp', 'Hà', 'Hân', 'Thụy',
            'Chi', 'Giang', 'Kim', 'Mai', 'Anh', 'Lệ', 'Vân', 'Nhi', 'Quỳnh', 'Nhung',
            'Trang', 'Huệ', 'Duyên', 'Phượng', 'Thương', 'Như', 'Bích', 'Cẩm', 'Mỹ', 'Hoa',
            'Thanh', 'Thu', 'Lý', 'Tiên', 'Yến', 'Hồng', 'Trinh', 'Loan', 'Thắm', 'Hiền',
            'Thùy', 'Châu', 'Ngà', 'Khánh', 'Tú', 'Nhàn', 'Thơm', 'Hoài', 'Tâm', 'Lam',
            'Thẩm', 'Nguyệt', 'Bảo', 'Hà', 'Trúc', 'Liên', 'Thủy', 'Thái', 'Phúc', 'Ân',
            'Băng', 'Diễm', 'Khuê', 'Cát', 'Uyển', 'Giao', 'Chuyên', 'Tuyền', 'Mơ', 'Mận',
            // EN
            'Mary', 'Patricia', 'Jennifer', 'Linda', 'Elizabeth', 'Barbara', 'Susan', 'Jessica',
            'Sarah', 'Karen', 'Lisa', 'Nancy', 'Betty', 'Margaret', 'Sandra', 'Ashley', 'Kimberly',
            'Emily', 'Donna', 'Michelle', 'Carol', 'Amanda', 'Dorothy', 'Melissa', 'Deborah',
            'Stephanie', 'Rebecca', 'Sharon', 'Laura', 'Cynthia', 'Kathleen', 'Amy', 'Angela',
            'Shirley', 'Anna', 'Brenda', 'Pamela', 'Emma', 'Nicole', 'Helen', 'Samantha', 'Katherine',
            'Christine', 'Debra', 'Rachel', 'Carolyn', 'Janet', 'Catherine', 'Maria', 'Heather',
            'Diane', 'Ruth', 'Julie', 'Olivia', 'Joyce', 'Virginia', 'Victoria', 'Kelly', 'Lauren',
            'Christina', 'Joan', 'Evelyn', 'Judith', 'Megan', 'Cheryl', 'Andrea', 'Hannah', 'Martha',
            'Jacqueline', 'Frances', 'Gloria', 'Ann', 'Teresa', 'Kathryn', 'Sara', 'Janice', 'Jean',
            'Alice', 'Madison', 'Doris', 'Abigail', 'Julia', 'Judy', 'Grace', 'Denise', 'Amber',
            'Marilyn', 'Beverly', 'Danielle', 'Theresa', 'Sophia', 'Marie', 'Diana', 'Brittany',
            'Natalie', 'Isabella', 'Charlotte', 'Rose', 'Alexis', 'Kayla'
        ]

        // Sinh ngẫu nhiên: kết hợp tên đệm + tên chính (có thể có hoặc không có tên đệm)
        const lastName = lastNames[getRandomInt(0, lastNames.length - 1)]
        const useMiddle = Math.random() > 0.45 // ~55% có tên đệm
        const isMale = Math.random() > 0.5
        const givenName = isMale
            ? givenNamesMale[getRandomInt(0, givenNamesMale.length - 1)]
            : givenNamesFemale[getRandomInt(0, givenNamesFemale.length - 1)]
        const middle = middleNames[getRandomInt(0, middleNames.length - 1)]
        const firstName = useMiddle ? `${middle} ${givenName}` : givenName

        log('INFO', `Entering Name: ${lastName} ${firstName}`)
        const firstNameSelector = 'input[name="FirstName"], input#firstNameInput, input[name="firstNameInput"]'
        const lastNameSelector = 'input[name="LastName"], input#lastNameInput, input[name="lastNameInput"]'

        await page.waitForSelector(firstNameSelector, { state: 'visible' })

        // 9. Uncheck marketing opt-in if present
        const marketingSelector = 'input[name="iOptinEmail"], input#iOptinEmail, input#marketingOptIn, [data-testid="marketingOptIn"]'
        const optIn = await page.$(marketingSelector)
        if (optIn && await optIn.isChecked()) {
            log('INFO', 'Unchecking marketing opt-in...')
            await optIn.uncheck()
        }

        await humanType(page, firstNameSelector, firstName)
        await page.waitForTimeout(getRandomInt(800, 1500))
        await humanType(page, lastNameSelector, lastName)
        await page.waitForTimeout(getRandomInt(1000, 2000))

        // Final Next button
        const finalNextSelector = 'button[data-testid="primaryButton"], button#nextbutton, ' + submitSelector
        await fluentUIClick(page, finalNextSelector)
        await waitForPageStable(page)
        await page.waitForTimeout(getRandomInt(5000, 10000))

        // 10. Check for CAPTCHA (Human verification challenge)
        const captchaIframeSelector = 'iframe[title="Human verification challenge"], iframe[src*="arkoselabs"], iframe[data-testid="humanCaptchaIframe"]'
        const captchaFrame = await page.$(captchaIframeSelector)
        if (captchaFrame || await page.isVisible(captchaIframeSelector)) {
            const solved = await solveArkosePressAndHold(page)
            if (solved) {
                log('SUCCESS', '✅ CAPTCHA solved automatically!')
            } else {
                log('INFO', 'Automatic solve failed. Please solve manually...')

                await page.waitForSelector(captchaIframeSelector, { state: 'hidden', timeout: 0 })
                log('SUCCESS', '✅ CAPTCHA solved manually! Continuing...')
            }
            await waitForPageStable(page)
        }

        // 11. Finalize Sequence (Poll until Dashboard or Security page reached)
        log('INFO', 'Finalizing account setup. Waiting for final setup screens...')
        let finalized = false
        const startTime = Date.now()

        while (!finalized) {
            const url = page.url()

            // --- a. Handle Privacy Notice ---
            if (url.includes('privacynotice.account.microsoft.com')) {
                log('INFO', 'Privacy Notice detected. Waiting for "OK" button...')
                const okButton = page.locator('button.ms-Button--primary:has-text("OK"), button:has-text("OK")').first()
                if (await okButton.isVisible({ timeout: 2000 }).catch(() => false)) {
                    log('INFO', 'Clicking OK on Privacy Notice...')
                    await okButton.click()
                    await page.waitForTimeout(3000)
                    continue // Re-check URL after click
                }
            }



            // --- b2. Handle Passkey / KeyPass / Security Prompts ---
            const passkeySkip = page.locator('button#close-button, button[data-testid="secondaryButton"], button:has-text("Cancel"), button:has-text("Skip"), button:has-text("Bỏ qua"), button:has-text("Not now")').first()
            if (await passkeySkip.isVisible({ timeout: 2000 }).catch(() => false)) {
                log('INFO', 'Passkey/Security prompt detected. Skipping...')
                await passkeySkip.click()
                await page.waitForTimeout(3000)
                continue
            }

            // --- b. Handle Stay Signed In ---
            const stayBtn = page.locator('input#idSIButton9, button:has-text("Yes"), button:has-text("Có"), input[value="Yes"]').first()
            if (await stayBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                log('INFO', 'Stay Signed In prompt detected. Clicking Yes...')
                await stayBtn.click()
                await page.waitForTimeout(3000)
                continue // Re-check URL after click
            }

            // --- c. Check for Final Destination ---
            if (url.includes('account.microsoft.com') ||
                url.includes('password/Change') ||
                url.includes('rewards.bing.com') ||
                url.includes('myaccount.microsoft.com')) {
                log('SUCCESS', 'Final destination reached.')
                finalized = true
            }

            // --- d. Safety Timeout (10 minutes) ---
            if (Date.now() - startTime > 600000) {
                log('WARN', 'Finalization logic timed out after 10 mins.')
                finalized = true
            }

            if (!finalized) {
                await page.waitForTimeout(3000) // Poll every 3 seconds
            }
        }

        log('INFO', 'Navigating to security/change password page...')
        await page.goto('https://account.live.com/password/Change?mkt=en-US&refd=account.microsoft.com&refp=security', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => { })

        // Check if "Add/Change password" form is present
        const passwordInput = page.locator('#iPassword')
        const retypeInput = page.locator('#iRetypePassword')
        const saveBtn = page.locator('#UpdatePasswordAction')

        if (await passwordInput.isVisible({ timeout: 5000 }).catch(() => false)) {
            log('INFO', 'Form "Add a password" detected. Securing account...')
            await humanType(page, passwordInput, initialAccount.password)
            await page.waitForTimeout(getRandomInt(1000, 2000))
            await humanType(page, retypeInput, initialAccount.password)
            await page.waitForTimeout(getRandomInt(1500, 2500))

            log('INFO', 'Clicking Save password...')
            await fluentUIClick(page, saveBtn)
            await waitForPageStable(page)
            await page.waitForTimeout(getRandomInt(3000, 5000))
        }

        // 11. Activate Microsoft Rewards via Referral
        log('INFO', 'Activating Microsoft Rewards via referral link...')
        await page.goto('https://rewards.bing.com/welcome?rh=960784F9&ref=rafsrchae', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => { })
        await waitForPageStable(page)

        // Click "Start earning rewards" link
        const startEarningSelector = 'a#start-earning-rewards-link'
        if (await page.isVisible(startEarningSelector).catch(() => false)) {
            log('INFO', 'Clicking "Start earning rewards" link...')
            await fluentUIClick(page, startEarningSelector)
            await page.waitForTimeout(getRandomInt(3000, 5000))
        }

        await page.waitForTimeout(getRandomInt(3000, 5000))

        // Click "Get Rewards now" button/span
        const getRewardsSelector = 'button:has-text("Get Rewards now"), button:has-text("Nhận phần thưởng ngay"), span:has-text("Get Rewards now")'
        if (await page.isVisible(getRewardsSelector).catch(() => false)) {
            log('INFO', 'Clicking "Get Rewards now" button...')
            await fluentUIClick(page, getRewardsSelector)
            await page.waitForTimeout(getRandomInt(3000, 5000))
        }

        log('SUCCESS', '✅ Registration and Rewards activation completed!')


        log('INFO', 'The browser will remain open so you can review the account.')
        log('INFO', 'Dữ liệu sẽ được tự động lưu mỗi 10 giây.')
        log('INFO', 'Đóng trình duyệt hoặc nhấn Ctrl+C để kết thúc.')

        // Periodic save every 10 seconds while waiting
        const saveInterval = setInterval(async () => {
            if (browser.isConnected()) {
                await persistSessionData(true) // silent save
            } else {
                clearInterval(saveInterval)
            }
        }, 10000)

        // Hang until disconnected or manually stopped
        while (browser.isConnected()) {
            await new Promise(r => setTimeout(r, 1000))
        }

        clearInterval(saveInterval)

    } catch (e) {
        log('ERROR', `Flow failed: ${e.message}`)
    }

    setupCleanupHandlers(async () => {
        await persistSessionData()
        releaseProxyLock(proxyKey, projectRoot)
        if (browser?.isConnected?.()) {
            await browser.close()
        }
    })

    log('INFO', 'Process ended.')
}

/**
 * Automates the "Press and Hold" Arkose CAPTCHA
 */
async function solveArkosePressAndHold(page) {
    log('INFO', 'Attempting to solve "Press and Hold" CAPTCHA...')

    try {
        // Wait for the outer captcha frame
        const outerFrameSelector = 'iframe[title="Human verification challenge"], iframe[src*="arkoselabs"]'
        await page.waitForSelector(outerFrameSelector, { state: 'visible', timeout: 15000 })

        // Find the interactive button inside nested frames
        // We look for aria-label, text content, or specific IDs commonly used by Arkose
        const selectors = [
            'button:has-text("Press and hold")',
            'div:has-text("Press and hold")',
            '[aria-label="Press and hold"]',
            '#home_children_button',
            '#Tay_nhan_giu'
        ]

        let targetElement = null
        let targetFrame = null

        // Recursive search for the button in all frames
        const frames = page.frames()
        for (const frame of frames) {
            for (const selector of selectors) {
                try {
                    const el = await frame.$(selector)
                    if (el && await el.isVisible()) {
                        targetElement = el
                        targetFrame = frame
                        break
                    }
                } catch (e) { }
            }
            if (targetElement) break
        }

        if (!targetElement) {
            log('WARN', 'Could not find "Press and hold" button via standard selectors. Trying center click fallback...')
            // Fallback: Click and hold the center of the captcha iframe
            const frameElement = await page.$(outerFrameSelector)
            const box = await frameElement.boundingBox()
            if (box) {
                const centerX = box.x + box.width / 2
                const centerY = box.y + box.height / 2

                await page.mouse.move(centerX, centerY, { steps: 10 })
                await page.mouse.down()
                log('INFO', 'Holding center of iframe...')
                await page.waitForTimeout(getRandomInt(8000, 12000))
                await page.mouse.up()
                return true
            }
            return false
        }

        log('INFO', 'Target button found. Starting hold sequence...')
        const box = await targetElement.boundingBox()
        if (!box) return false

        // Move to button with slight randomization
        await page.mouse.move(
            box.x + box.width / 2 + getRandomInt(-5, 5),
            box.y + box.height / 2 + getRandomInt(-5, 5),
            { steps: 15 }
        )

        // Press down
        await page.mouse.down()

        // Duration: 8-12 seconds is typical for Arkose
        const holdDuration = getRandomInt(8500, 11500)
        log('INFO', `Holding for ${(holdDuration / 1000).toFixed(1)} seconds...`)
        await page.waitForTimeout(holdDuration)

        // Release
        await page.mouse.up()
        await page.waitForTimeout(2000)

        return true
    } catch (e) {
        log('ERROR', `Error in solveArkosePressAndHold: ${e.message}`)
        return false
    }
}

main().catch(err => {
    log('ERROR', `Fatal error: ${err.message}`)
    process.exit(1)
})
