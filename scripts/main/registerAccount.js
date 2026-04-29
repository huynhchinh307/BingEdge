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
        if (response.data.status === 'success') {
            const proxyStr = response.data.proxy // format: "ip:port:user:pass"
            const parts = proxyStr.split(':')
            log('SUCCESS', `Proxy Rotated: ${parts[0]}:${parts[1]} | IP: ${response.data.ip}`)
            return {
                server: `http://${parts[0]}:${parts[1]}`, // For Playwright
                host: parts[0],
                port: parts[1],
                username: parts[2],
                password: parts[3]
            }
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
    if (!proxy) return null
    try {
        log('INFO', 'Syncing location and timezone with Proxy IP...')
        // We use a simple axios call through the proxy
        const auth = (proxy.username && proxy.password) ? `${proxy.username}:${proxy.password}@` : ''
        const proxyUrl = proxy.server.replace('http://', `http://${auth}`)

        const { HttpsProxyAgent } = await import('https-proxy-agent')
        const agent = new HttpsProxyAgent(proxyUrl)

        const response = await axios.get('http://ip-api.com/json', {
            httpAgent: agent,
            timeout: 10000
        })

        if (response.data && response.data.status === 'success') {
            log('SUCCESS', `Location: ${response.data.city}, ${response.data.country} | Timezone: ${response.data.timezone}`)
            return response.data
        }
    } catch (e) {
        log('WARN', `Could not fetch IP location: ${e.message}`)
    }
    return null
}


async function main() {
    log('INFO', 'Starting Fully Automated Account Registration...')
    let proxyKey = 'NO_PROXY'

    // 1. Rotation Proxy
    const rotatedProxy = await rotateProxy(config.proxyRotationUrl || args.rotationUrl)
    if (!rotatedProxy && (config.proxyRotationUrl || args.rotationUrl)) {
        log('ERROR', 'Could not rotate proxy. Check config.proxyRotationUrl')
    }

    proxyKey = getProxyKey({ proxy: rotatedProxy })
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
        proxy: rotatedProxy ? {
            url: `http://${rotatedProxy.host}`,
            port: rotatedProxy.port,
            username: rotatedProxy.username,
            password: rotatedProxy.password
        } : {},
        geoLocale: 'auto',
        langCode: 'vi',
        group: 'AutoRegister',
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
        proxy: rotatedProxy || undefined,
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

    const ipLocation = await getIpLocation(rotatedProxy)
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

        // 6. Password (Conditional - Microsoft flow varies)
        const passwordField = page.locator('input[type="password"]').first()
        if (await passwordField.isVisible()) {
            log('INFO', `Entering Password: ${password}`)
            await humanType(page, passwordField, password)
            await page.waitForTimeout(getRandomInt(1000, 2000))
            await fluentUIClick(page, submitSelector)
            await waitForPageStable(page)
        }

        // 7. Birth Date (Custom Dropdowns)
        log('INFO', 'Filling Birth Date...')
        await page.waitForSelector('[data-testid="birthdateControls"], #BirthMonthDropdown', { state: 'visible' })

        const day = String(getRandomInt(1, 25)) // Avoid 29-31 for safety
        const monthIndex = getRandomInt(1, 12)
        const year = String(getRandomInt(1985, 1998))

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

        // 8. Name - Vietnamese Random (Expanded List)
        const lastNames = [
            // Phổ biến nhất
            'Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng',
            'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý', 'Lưu', 'Trương', 'Đinh', 'Cao',
            // Khá phổ biến
            'Phùng', 'Chu', 'Trịnh', 'Quách', 'Đào', 'Hà', 'Tạ', 'Lương', 'Mai', 'Liễu',
            'Lục', 'Lâm', 'Đoàn', 'Kiều', 'Thái', 'Vương', 'Tống', 'Tô', 'Từ', 'Mạc',
            'Châu', 'Phó', 'Hứa', 'Nghiêm', 'Âu', 'Diệp', 'Sầm', 'Giáp', 'Thân', 'Thạch',
            // Ít phổ biến hơn nhưng hợp lệ
            'Nông', 'Vi', 'Đoàn', 'Lã', 'Đới', 'Chiêu', 'Vương', 'Ông', 'Bạch', 'La',
            'Văn', 'Kim', 'Đường', 'Tề', 'Khuất', 'Tưởng', 'Đồng', 'Khổng', 'Trang', 'Biên',
            'Chung', 'Cái', 'Lại', 'Mã', 'Liêu', 'Trịnh', 'Hình', 'Hoa', 'Triệu', 'Thẩm'
        ]

        // Tên đệm phổ biến
        const middleNames = [
            'Thị', 'Văn', 'Đức', 'Thành', 'Minh', 'Quang', 'Anh', 'Bảo', 'Hữu', 'Công',
            'Ngọc', 'Tiến', 'Phước', 'Thế', 'Trung', 'Xuân', 'Như', 'Mỹ', 'Thanh', 'Tấn',
            'Phú', 'Gia', 'Hồng', 'Khắc', 'Nhật', 'Trọng', 'Hoài', 'Bích', 'Kim', 'Tú'
        ]

        // Tên chính đa dạng (nam + nữ)
        const givenNamesMale = [
            'Hùng', 'Dũng', 'Tuấn', 'Minh', 'Nam', 'Phong', 'Sơn', 'Quân', 'Huy', 'Long',
            'Vinh', 'Đạt', 'Cường', 'Hiếu', 'Nghĩa', 'Khôi', 'Bình', 'Thịnh', 'Tiến', 'Tài',
            'Quang', 'Quốc', 'Thắng', 'Khải', 'Sang', 'Trung', 'Tú', 'Việt', 'Hải', 'Thành',
            'Duy', 'Bảo', 'Đức', 'Nhân', 'Trọng', 'Khánh', 'Tâm', 'Hòa', 'Thạch', 'Tấn',
            'Phúc', 'Gia', 'Khoa', 'Lộc', 'Phước', 'Thế', 'Nhật', 'Quý', 'Hậu', 'Thiện',
            'Lâm', 'Cẩm', 'Đăng', 'Mạnh', 'Vũ', 'Tín', 'Nhân', 'Hào', 'Kiên', 'Lực',
            'Dương', 'Hưng', 'Toàn', 'Tùng', 'Quân', 'Trí', 'Tùng', 'Đạo', 'Nguyên', 'Hào'
        ]
        const givenNamesFemale = [
            'Linh', 'Hương', 'Ngọc', 'Thảo', 'Lan', 'Oanh', 'Phương', 'Hạnh', 'Tuyết', 'Yên',
            'My', 'Ngân', 'Uyên', 'Vy', 'Xuân', 'Trâm', 'Diệp', 'Hà', 'Hân', 'Thụy',
            'Chi', 'Giang', 'Kim', 'Mai', 'Anh', 'Lệ', 'Vân', 'Nhi', 'Quỳnh', 'Nhung',
            'Trang', 'Huệ', 'Duyên', 'Phượng', 'Thương', 'Như', 'Bích', 'Cẩm', 'Mỹ', 'Hoa',
            'Thanh', 'Thu', 'Lý', 'Tiên', 'Yến', 'Hồng', 'Trinh', 'Loan', 'Thắm', 'Hiền',
            'Thùy', 'Châu', 'Ngà', 'Khánh', 'Tú', 'Nhàn', 'Thơm', 'Hoài', 'Tâm', 'Lam',
            'Thẩm', 'Nguyệt', 'Bảo', 'Hà', 'Trúc', 'Liên', 'Thủy', 'Thái', 'Phúc', 'Ân'
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
        const captchaIframeSelector = 'iframe[title="Human verification challenge"], iframe[src*="arkoselabs"]'
        const captchaFrame = await page.$(captchaIframeSelector)
        if (captchaFrame || await page.isVisible(captchaIframeSelector)) {
            log('WARN', '⚠️  CAPTCHA detected (Human verification challenge)!')
            log('INFO', 'Please solve the CAPTCHA manually in the browser window.')
            log('INFO', 'The script will wait until the challenge is completed.')

            // Wait until the captcha iframe is gone
            await page.waitForSelector(captchaIframeSelector, { state: 'hidden', timeout: 0 })
            log('SUCCESS', '✅ CAPTCHA solved! Continuing...')
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

        log('SUCCESS', '✅ Registration completed successfully!')


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

main().catch(err => {
    log('ERROR', `Fatal error: ${err.message}`)
    process.exit(1)
})
