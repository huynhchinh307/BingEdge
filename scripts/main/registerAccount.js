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
    releaseProxyLock,
    deleteAccount,
    openDb
} from '../utils.js'

const __dirname = getDirname(import.meta.url)
const projectRoot = getProjectRoot(__dirname)

const args = parseArgs()
const { data: config, path: configPath } = loadConfig(projectRoot, args.dev || false)

// === CONFIG: Thay đổi URL đích ở đây ===
const urlRef = 'https://rewards.bing.com/welcome?rh=45F6AD&ref=rafsrchae'
const groupRegister = 'EdgeV6'

let lastRotatedProxy = null // Cache last successful proxy for multi-slot reuse

// --- Persistence logic for new config fields ---
if ((args.rotationUrl && !config.proxyRotationUrl) || (args.otpKey && !config.apiOtpKey)) {
    try {
        const dbPath = path.join(projectRoot, 'rewards_data.db')
        const db = openDb(dbPath, { timeout: 5000 })

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

async function rotateProxy(url, maxWaitMs = 360000) {
    if (!url) return null

    const started = Date.now()
    let networkRetries = 0
    const maxNetworkRetries = 5

    while (true) {
        try {
            log('INFO', 'Rotating proxy...')
            const response = await axios.get(url, { timeout: 15000 })
            const data = response.data
            networkRetries = 0 // reset on successful HTTP response

            // SUCCESS
            if (data.status === 'success' || data.success === true) {
                const proxyStr = data.proxy
                if (proxyStr) {
                    const parts = proxyStr.split(':')
                    log('SUCCESS', `Proxy Rotated: ${parts[0]}:${parts[1]} | IP: ${data.ip || 'Unknown'}`)
                    return {
                        server: `http://${parts[0]}:${parts[1]}`,
                        host: parts[0],
                        port: parts[1],
                        username: parts[2],
                        password: parts[3],
                        isProxyV6: (data.ip && data.ip.includes(':')) || parts[0].includes(':')
                    }
                } else {
                    log('SUCCESS', 'Proxy rotation triggered successfully (Static Proxy)')
                    return { triggerOnly: true }
                }
            }

            // RATE LIMIT or cooldown — use retry_after if present
            const msg = data.message || data.msg || ''
            let waitSec = null
            if (data.retry_after) {
                waitSec = parseInt(data.retry_after)
                log('WARN', `Proxy rate limited (${data.error_code || 'COOLDOWN'}). retry_after=${waitSec}s — ${msg}`)
            } else {
                // Parse from message: "36s", "120 seconds", "4 minutes"
                const mMin = msg.match(/(\d+)\s*minute/i)
                const mSec = msg.match(/(\d+)\s*s(ec(ond)?s?)?/i)
                if (mMin) waitSec = parseInt(mMin[1]) * 60
                else if (mSec) waitSec = parseInt(mSec[1])
                log('WARN', `Proxy rotation not ready (wait ${waitSec ?? '?'}s): ${msg}`)
            }

            const waitMs = waitSec ? (waitSec + 3) * 1000 : 30000
            if (Date.now() - started + waitMs > maxWaitMs) {
                log('ERROR', `Proxy rotation aborted (max wait exceeded): ${msg}`)
                return null
            }
            log('INFO', `Waiting ${Math.round(waitMs / 1000)}s before retry...`)
            await new Promise(r => setTimeout(r, waitMs))

        } catch (e) {
            networkRetries++
            log('WARN', `Proxy rotation network error (${networkRetries}/${maxNetworkRetries}): ${e.message}`)
            if (networkRetries >= maxNetworkRetries) {
                log('ERROR', `Proxy rotation aborted after ${maxNetworkRetries} consecutive network failures`)
                return null
            }
            const retryDelay = Math.min(5000 * networkRetries, 30000) // 5s → 10s → 15s → 20s → 25s
            log('INFO', `Retrying rotation in ${retryDelay / 1000}s...`)
            await new Promise(r => setTimeout(r, retryDelay))
        }
    }
}

function isEmailBotLike(email) {
    const name = email.split('@')[0].toLowerCase()
    const letters = name.replace(/[^a-z]/g, '')
    const vowels = letters.replace(/[^aeiou]/g, '')
    const digits = name.replace(/[^0-9]/g, '')

    if (name.length > 18) return `name too long (${name.length} chars)`
    if (digits.length > 4) return `too many digits (${digits.length})`
    if (letters.length >= 5 && vowels.length / letters.length < 0.20)
        return `low vowel ratio (${vowels.length}/${letters.length} letters)`
    if (/[^aeiou]{5,}/.test(letters)) return `5+ consecutive consonants`
    return null
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
}

function extractNameFromEmail(email) {
    const raw = email.split('@')[0].toLowerCase()
    const base = raw.replace(/\d+$/, '') // strip trailing digits

    // Separator-based split: john.doe / john_doe / john-doe
    const sepMatch = base.match(/^([a-z]{2,})[-._]([a-z]{2,})/)
    if (sepMatch) {
        return { firstName: capitalize(sepMatch[1]), lastName: capitalize(sepMatch[2]) }
    }

    // Dictionary prefix match (longest first for greedy match)
    const NAMES = [
        // VN transliterated
        'nguyen', 'hoang', 'phuong', 'thanh', 'trang', 'minh', 'hung',
        'dung', 'tuan', 'quang', 'linh', 'hieu', 'thao', 'huong',
        'ngoc', 'vinh', 'cuong', 'khoi', 'thinh', 'tien', 'khoa',
        'long', 'son', 'van', 'bao', 'duc', 'lan', 'nhi', 'ha',
        'tran', 'le', 'pham', 'huynh', 'phan', 'vu', 'vo', 'dang',
        'bui', 'do', 'ho', 'ngo', 'duong', 'ly', 'quoc', 'dat',
        'thang', 'tuyen', 'mai', 'dao', 'uyen', 'vy', 'khanh', 'phuc',
        'tung', 'nhung', 'truc', 'quynh', 'tram', 'nhien', 'tuyen'
    ].sort((a, b) => b.length - a.length) // longest match first

    for (const first of NAMES) {
        if (base.startsWith(first) && base.length > first.length + 1) {
            const rest = base.slice(first.length).replace(/^\d+/, '').replace(/\d+$/, '')
            if (rest.length >= 2 && /^[a-z]+$/.test(rest)) {
                return { firstName: capitalize(first), lastName: capitalize(rest) }
            }
        }
    }

    return null // fallback to random
}

async function createOtpOrder(apiKey, maxAttempts = 10) {
    if (!apiKey) return null
    let apiFailures = 0
    for (let i = 0; i < maxAttempts; i++) {
        try {
            log('INFO', `Renting Gmail for OTP... (Attempt ${i + 1}/${maxAttempts})`)
            const response = await axios.get(`https://api.shopgmail9999.com/api/ApiV2/CreateOrder?apikey=${apiKey}&service=microsoft`)
            if (response.data.status === 'success') {
                const data = response.data.data // { email, orderid, ... }
                const botReason = isEmailBotLike(data.email)
                if (botReason) {
                    log('WARN', `Skipping bot-like email: ${data.email} (${botReason}). Getting new one...`)
                    await new Promise(r => setTimeout(r, 3000))
                    continue
                }
                return data
            } else {
                log('WARN', `OTP Order failed: ${response.data.msg}. Retrying in 15s...`)
                if (++apiFailures >= 3) return null
                await new Promise(r => setTimeout(r, 15000))
            }
        } catch (e) {
            const errorMsg = e.response?.data?.msg || e.message
            log('ERROR', `OTP Order error (400?): ${errorMsg}. Retrying in 15s...`)
            if (++apiFailures >= 3) return null
            await new Promise(r => setTimeout(r, 15000))
        }
    }
    log('ERROR', `Could not get a valid Gmail after ${maxAttempts} attempts`)
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
        if (!page.isClosed()) {
            await page.keyboard.press('Enter').catch(() => { })
        }
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

function normalizeTimezone(tz) {
    if (!tz || typeof tz !== 'string') return 'UTC'
    // Đã là IANA ID (có chứa '/') → trả về luôn
    if (tz.includes('/')) return tz
    // Convert UTC offset (+07:00, -05:00, ...) → IANA ID
    const offsetMap = {
        '-12:00': 'Etc/GMT+12', '-11:00': 'Pacific/Pago_Pago', '-10:00': 'Pacific/Honolulu',
        '-09:00': 'America/Anchorage', '-08:00': 'America/Los_Angeles', '-07:00': 'America/Denver',
        '-06:00': 'America/Chicago', '-05:00': 'America/New_York', '-04:00': 'America/Halifax',
        '-03:00': 'America/Sao_Paulo', '-02:00': 'Atlantic/South_Georgia', '-01:00': 'Atlantic/Azores',
        '+00:00': 'UTC', '+01:00': 'Europe/Paris', '+02:00': 'Europe/Kiev',
        '+03:00': 'Europe/Moscow', '+03:30': 'Asia/Tehran', '+04:00': 'Asia/Dubai',
        '+04:30': 'Asia/Kabul', '+05:00': 'Asia/Karachi', '+05:30': 'Asia/Kolkata',
        '+05:45': 'Asia/Kathmandu', '+06:00': 'Asia/Dhaka', '+06:30': 'Asia/Rangoon',
        '+07:00': 'Asia/Bangkok', '+08:00': 'Asia/Shanghai', '+08:45': 'Australia/Eucla',
        '+09:00': 'Asia/Tokyo', '+09:30': 'Australia/Darwin', '+10:00': 'Australia/Sydney',
        '+10:30': 'Australia/Lord_Howe', '+11:00': 'Pacific/Noumea', '+12:00': 'Pacific/Auckland',
        '+13:00': 'Pacific/Apia', '+14:00': 'Pacific/Kiritimati'
    }
    return offsetMap[tz] || 'UTC'
}

async function getIpLocation(proxy, knownIp = null) {
    const isNoProxy = !proxy || !proxy.server
    const hostPart = isNoProxy ? '' : proxy.server.replace(/^(https?|socks[45]):\/\//i, '').split(':')[0]
    const isV6 = !isNoProxy && (proxy.isProxyV6 || hostPart.includes('[') || (hostPart.includes(':') && !hostPart.includes('.')))

    if (isV6) {
        log('INFO', 'IPv6 Proxy detected. Location sync might be slow or fail.')
    }

    const IP2LOCATION_KEY = '6629706EAD9DB314262AA7FA68098760'

    const services = [
        { url: 'https://ipwho.is/', parse: d => ({ city: d.city || '', country: d.country || '', timezone: d.timezone?.id || 'UTC', lat: parseFloat(d.latitude || 0), lon: parseFloat(d.longitude || 0) }) },
        { url: 'https://freeipapi.com/api/json', parse: d => ({ city: d.cityName || '', country: d.countryName || '', timezone: d.timeZone || 'UTC', lat: parseFloat(d.latitude || 0), lon: parseFloat(d.longitude || 0) }) },
        { url: 'https://ipapi.co/json/', parse: d => ({ city: d.city || '', country: d.country_name || '', timezone: d.timezone || 'UTC', lat: parseFloat(d.latitude || 0), lon: parseFloat(d.longitude || 0) }) },
        { url: 'http://ip-api.com/json', parse: d => ({ city: d.city || '', country: d.country || '', timezone: d.timezone || 'UTC', lat: parseFloat(d.lat || 0), lon: parseFloat(d.lon || 0) }) },
        { url: 'https://ipwhois.app/json/', parse: d => ({ city: d.city || '', country: d.country || '', timezone: d.timezone || 'UTC', lat: parseFloat(d.latitude || 0), lon: parseFloat(d.longitude || 0) }) }
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

        // --- ip2location: dùng IP đã biết từ health check, hoặc detect lại nếu chưa có ---
        try {
            let detectedIp = knownIp || null
            if (!detectedIp) {
                const ipDetectEndpoints = [
                    { url: 'http://ip-api.com/json', extract: d => d.query },
                    { url: 'http://ipwho.is/', extract: d => d.ip },
                    { url: 'https://api64.ipify.org?format=json', extract: d => d.ip }
                ]
                for (const ep of ipDetectEndpoints) {
                    try {
                        const ipRes = await axios.get(ep.url, {
                            httpsAgent: axiosAgent,
                            httpAgent: axiosAgent,
                            timeout: isV6 ? 15000 : 8000
                        })
                        const ip = ep.extract(ipRes.data)
                        if (ip) { detectedIp = ip; break }
                    } catch { /* try next */ }
                }
            }

            if (detectedIp) {
                const geoRes = await axios.get(`https://api.ip2location.io/?key=${IP2LOCATION_KEY}&ip=${detectedIp}&format=json`, {
                    timeout: 10000
                })
                const d = geoRes.data
                const data = {
                    city: d.city_name || '',
                    country: d.country_name || '',
                    timezone: normalizeTimezone(d.time_zone),
                    lat: parseFloat(d.latitude || 0),
                    lon: parseFloat(d.longitude || 0)
                }
                if (data.lat !== 0 || data.timezone !== 'UTC') {
                    log('SUCCESS', `Location: ${data.city}, ${data.country} | Timezone: ${data.timezone} (via ip2location.io | IP: ${detectedIp})`)
                    return data
                }
            } else {
                log('WARN', 'ip2location.io skipped: could not detect proxy IP')
            }
        } catch (e) {
            log('WARN', `ip2location.io failed: ${e.message}`)
        }

        for (const svc of services) {
            try {
                const response = await axios.get(svc.url, {
                    httpsAgent: axiosAgent,
                    httpAgent: axiosAgent,
                    timeout: isV6 ? 20000 : 12000
                })

                if (response.data) {
                    const data = svc.parse(response.data)

                    if (data.lat !== 0 || data.timezone !== 'UTC') {
                        log('SUCCESS', `Location: ${data.city}, ${data.country} | Timezone: ${data.timezone} (via ${new URL(svc.url).hostname})`)
                        return data
                    }
                }
            } catch (e) {
                const status = e.response?.status
                log('WARN', `IP API (${new URL(svc.url).hostname}) failed: ${e.message}${status ? ` (Status: ${status})` : ''}`)
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

    log('ERROR', 'All IP Location services failed or returned 502.')
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
            lastRotatedProxy = rotatedProxy // Cache for next slots
        }
    } else {
        if (config.proxyRotationUrl || args.rotationUrl) {
            log('ERROR', 'Could not rotate proxy or rotation failed. Checking Global Fallback...')
            if (lastRotatedProxy) {
                log('INFO', `Reusing last rotated proxy: ${lastRotatedProxy.host}:${lastRotatedProxy.port}`)
                effectiveProxy = lastRotatedProxy
            }
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
        throw new Error(`Proxy in use: ${proxyKey}`)
    }

    // 1.5. Proxy health check trước khi rent Gmail
    let detectedProxyIp = null
    if (effectiveProxy) {
        log('INFO', 'Checking proxy connectivity...')
        try {
            const { HttpsProxyAgent } = await import('https-proxy-agent')
            const { HttpProxyAgent } = await import('http-proxy-agent')
            const { SocksProxyAgent } = await import('socks-proxy-agent')

            const serverUrl = effectiveProxy.server.includes('://') ? effectiveProxy.server : `http://${effectiveProxy.server}`
            const urlObj = new URL(serverUrl)
            let proxyUrl = serverUrl
            if (effectiveProxy.username && effectiveProxy.password) {
                proxyUrl = `${urlObj.protocol}//${encodeURIComponent(effectiveProxy.username)}:${encodeURIComponent(effectiveProxy.password)}@${urlObj.host}`
            }
            let agent
            if (urlObj.protocol === 'socks4:' || urlObj.protocol === 'socks5:') {
                agent = new SocksProxyAgent(proxyUrl)
            } else if (urlObj.protocol === 'https:') {
                agent = new HttpsProxyAgent(proxyUrl)
            } else {
                agent = new HttpProxyAgent(proxyUrl)
            }

            const checkEndpoints = [
                'http://ip-api.com/json',
                'http://ipapi.co/json/',
                'http://ipwho.is/'
            ]
            let proxyOk = false
            for (const ep of checkEndpoints) {
                try {
                    const checkRes = await axios.get(ep, {
                        httpsAgent: agent,
                        httpAgent: agent,
                        timeout: 10000
                    })
                    const ip = checkRes.data?.query || checkRes.data?.ip || checkRes.data?.IPv4 || null
                    if (ip) detectedProxyIp = ip
                    log('SUCCESS', `Proxy OK — detected IP: ${ip || '?'} (via ${new URL(ep).hostname})`)
                    proxyOk = true
                    break
                } catch { /* try next */ }
            }
            if (!proxyOk) throw new Error('All health check endpoints failed')
        } catch (e) {
            log('ERROR', `Proxy health check FAILED: ${e.message}`)
            releaseProxyLock(proxyKey, projectRoot)
            throw new Error(`Proxy not working: ${e.message}`)
        }
    }

    // 2. Order OTP
    const otpKey = config.apiOtpKey || args.otpKey
    const order = await createOtpOrder(otpKey)
    if (!order) {
        log('ERROR', 'Could not rent email. Check config.apiOtpKey')
        throw new Error('Could not rent email')
    }

    const email = order.email
    const orderId = order.orderid
    const password = args.password || generateRandomPassword(14)

    // Extract birth year from last 4 digits of email local-part if valid
    const localPart = email.split('@')[0] || ''
    const yearMatch = localPart.match(/(\d{4})$/)
    let birthYear = null
    if (yearMatch) {
        const parsedYear = parseInt(yearMatch[1], 10)
        if (parsedYear >= 1920 && parsedYear <= 2010) {
            birthYear = parsedYear
            log('INFO', `Detected birth year ${birthYear} from email suffix`)
        }
    }

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
            password: effectiveProxy.password,
            isProxyV6: effectiveProxy.isProxyV6 || false
        } : {},
        geoLocale: 'auto',
        langCode: 'vi',
        group: groupRegister,
        saveFingerprint: { mobile: args.mobile || false, desktop: !(args.mobile || false) }
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
        '--disable-features=WebAuthentication,PasswordManagerOnboarding,PasswordManager,EnablePasswordsAccountStorage,Passkeys,WebAuthenticationProxy,U2F,msEdgeSync,EdgeIdentityConsistency,EdgeSyncConsent',
        '--disable-save-password-bubble',
        '--disable-sync',
        '--window-size=1920,1080'
    ]

    const browserType = config.browserType ?? 'chromium'

    const browser = await chromium.launch({
        headless: false,
        channel: browserType === 'edge' ? 'msedge' : undefined,
        proxy: effectiveProxy || undefined,
        args: [...BROWSER_ARGS]
    })

    // Save session when browser is closed unexpectedly (user closes manually)
    browser.on('disconnected', async () => {
        await persistSessionData()
        log('INFO', 'Browser disconnected.')
    })

    let fingerprint = null
    const fingerprintBrowser = browserType === 'edge' ? 'edge' : 'chrome'

    const isMobile = args.mobile || false
    const fingerprintGenerator = new FingerprintGenerator()
    fingerprint = fingerprintGenerator.getFingerprint({
        devices: isMobile ? ['mobile'] : ['desktop'],
        operatingSystems: isMobile ? ['android', 'ios'] : ['windows', 'macos', 'linux'],
        browsers: [fingerprintBrowser],
        screen: isMobile ? {
            minWidth: 360,
            maxWidth: 480,
            minHeight: 640,
            maxHeight: 926
        } : {
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
        fingerprint = await um.updateFingerprintUserAgent(fingerprint, isMobile) // isMobile: true/false
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
            const sessionType = args.mobile ? 'mobile' : 'desktop'
            const cookies = await currentContext.cookies()
            await saveCookies(sessionBase, cookies, sessionType)
            await saveFingerprint(sessionBase, currentFingerprint, sessionType)

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

    const ipLocation = await getIpLocation(effectiveProxy, detectedProxyIp)
    if (!ipLocation && !((args.geo || 'US').toLowerCase() === 'vi')) {
        log('ERROR', 'Stopping flow to prevent IP leak. Deleting account info...')
        deleteAccount(projectRoot, email, args.dev || false)
        releaseProxyLock(proxyKey, projectRoot)
        throw new Error('IP location failed — flow aborted to prevent IP leak')
    }
    const locale = (args.geo || 'US').toLowerCase() === 'vi' ? 'vi-VN' : 'en-US'

    const context = await newInjectedContext(browser, {
        fingerprint,
        newContextOptions: {
            viewport: isMobile ? { width: getRandomInt(360, 414), height: getRandomInt(700, 896) } : { width: getRandomInt(1366, 1920), height: getRandomInt(768, 1080) },
            locale: locale,
            timezoneId: ipLocation?.timezone,
            geolocation: ipLocation ? { latitude: ipLocation.lat, longitude: ipLocation.lon } : undefined,
            permissions: ['geolocation'],
            ignoreHTTPSErrors: true,
            bypassCSP: true,
            hasTouch: isMobile
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
        await page.goto('https://signup.live.com/signup', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(async (e) => {
            log('ERROR', `Failed to navigate to signup page: ${e.message}`)
            await deleteAccount(projectRoot, email, args.dev || false)
            throw new Error(`Signup navigation failed: ${e.message}`)
        })

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
            log('ERROR', 'OTP Timeout. Deleting account and aborting...')
            deleteAccount(projectRoot, email, args.dev || false)
            throw new Error('OTP Timeout')
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
        //await fluentUIClick(page, submitSelector)
        //await waitForPageStable(page)
        await page.waitForTimeout(getRandomInt(3000, 5000))
        // 6. Birth Date (Custom Dropdowns)
        log('INFO', 'Filling Birth Date...')
        await page.waitForSelector('[data-testid="birthdateControls"], #BirthMonthDropdown', { state: 'visible', timeout: 30000 })
        log('INFO', 'Birthdate controls visible')
        await waitForPageStable(page, 5000)

        const day = String(getRandomInt(1, 25)) // Avoid 29-31 for safety
        const monthIndex = getRandomInt(1, 12)
        const year = birthYear ? String(birthYear) : String(getRandomInt(1995, 2005))

        const months = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ]
        const monthName = months[monthIndex - 1]

        // Detect layout order: which dropdown is on the left (smaller X)?
        const monthBtn = page.locator('#BirthMonthDropdown').first()
        const dayBtn = page.locator('#BirthDayDropdown').first()
        const monthBox = await monthBtn.boundingBox().catch(() => null)
        const dayBox = await dayBtn.boundingBox().catch(() => null)
        const monthFirst = !monthBox || !dayBox || monthBox.x <= dayBox.x
        log('INFO', `Birthdate layout: ${monthFirst ? 'Month → Day' : 'Day → Month'}`)

        // Helper: open a dropdown, select option by exact text, wait for close
        async function selectDropdownOption(btnSelector, optionText, label) {
            const btn = page.locator(btnSelector).first()
            let opened = false
            for (let attempt = 1; attempt <= 3; attempt++) {
                await fluentUIClick(page, btn)
                const listbox = page.locator('div[role="listbox"], ul[role="listbox"], .fui-Listbox').first()
                opened = await listbox.isVisible({ timeout: 5000 }).catch(() => false)
                const ariaExpanded = await btn.getAttribute('aria-expanded').catch(() => null)
                if (opened || ariaExpanded === 'true') break
                log('WARN', `${label} dropdown did not open (attempt ${attempt}/3), retrying...`)
                await page.waitForTimeout(getRandomInt(800, 1500))
            }
            if (!opened) { log('WARN', `${label} dropdown failed to open, proceeding anyway`) }

            // Exact text match to avoid "5" matching "15", "25"
            const exactOption = page.locator(`[role="option"]`).filter({ hasText: new RegExp(`^\\s*${optionText}\\s*$`) }).first()
            const fallbackOption = page.locator(`[role="option"]`).filter({ hasText: optionText }).first()
            const option = await exactOption.isVisible({ timeout: 3000 }).catch(() => false) ? exactOption : fallbackOption
            await option.click()
            log('INFO', `${label} selected: ${optionText}`)

            // Wait for dropdown to close (aria-expanded → false)
            await page.waitForFunction(
                (sel) => {
                    const el = document.querySelector(sel)
                    return !el || el.getAttribute('aria-expanded') !== 'true'
                },
                btnSelector,
                { timeout: 5000 }
            ).catch(() => { })
            await page.waitForTimeout(getRandomInt(700, 1200))
        }

        // 1. Fill in detected order
        if (monthFirst) {
            await selectDropdownOption('#BirthMonthDropdown', monthName, 'Month')
            await selectDropdownOption('#BirthDayDropdown', day, 'Day')
        } else {
            await selectDropdownOption('#BirthDayDropdown', day, 'Day')
            await selectDropdownOption('#BirthMonthDropdown', monthName, 'Month')
        }

        // 2. Year (text input)
        log('INFO', `Filling Year: ${year}`)
        const yearInput = page.locator('input[name="BirthYear"], input#BirthYearInput').first()
        await yearInput.fill('')
        await humanType(page, yearInput, year)
        await page.waitForTimeout(getRandomInt(800, 1500))

        log('INFO', 'Birthdate filled. Clicking Next...')
        await fluentUIClick(page, submitSelector)
        await waitForPageStable(page)
        await page.waitForTimeout(getRandomInt(2000, 4000))
        // 8. Name - Vietnamese Random (Filtered for common names)
        const lastNames = [
            // Phổ biến nhất (Top 16 họ chiếm hơn 90% dân số VN)
            'Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng',
            'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý'
        ]

        // Tên đệm
        const middleNames = [
            'Thị', 'Văn', 'Đức', 'Thành', 'Minh', 'Quang', 'Anh', 'Bảo', 'Hữu', 'Công',
            'Ngọc', 'Tiến', 'Phước', 'Thế', 'Trung', 'Xuân', 'Như', 'Mỹ', 'Thanh', 'Tấn',
            'Phú', 'Gia', 'Hồng', 'Khắc', 'Nhật', 'Trọng', 'Hoài', 'Bích', 'Kim', 'Tú',
            'Đình', 'Xuân', 'Hoàng', 'Kiều', 'Tuấn', 'Nhã', 'Đan', 'Thủy', 'Hải', 'Song'
        ]

        // Tên chính đa dạng (nam + nữ)
        const givenNamesMale = [
            'Hùng', 'Dũng', 'Tuấn', 'Minh', 'Nam', 'Phong', 'Sơn', 'Quân', 'Huy', 'Long',
            'Vinh', 'Đạt', 'Cường', 'Hiếu', 'Nghĩa', 'Khôi', 'Bình', 'Thịnh', 'Tiến', 'Tài',
            'Quang', 'Quốc', 'Thắng', 'Khải', 'Sang', 'Trung', 'Tú', 'Việt', 'Hải', 'Thành',
            'Duy', 'Bảo', 'Đức', 'Nhân', 'Trọng', 'Khánh', 'Tâm', 'Hòa', 'Thạch', 'Tấn',
            'Phúc', 'Gia', 'Khoa', 'Lộc', 'Phước', 'Thế', 'Nhật', 'Quý', 'Hậu', 'Thiện',
            'Lâm', 'Cẩm', 'Đăng', 'Mạnh', 'Vũ', 'Tín', 'Nhân', 'Hào', 'Kiên', 'Lực'
        ]
        const givenNamesFemale = [
            'Linh', 'Hương', 'Ngọc', 'Thảo', 'Lan', 'Oanh', 'Phương', 'Hạnh', 'Tuyết', 'Yên',
            'My', 'Ngân', 'Uyên', 'Vy', 'Xuân', 'Trâm', 'Diệp', 'Hà', 'Hân', 'Thụy',
            'Chi', 'Giang', 'Kim', 'Mai', 'Anh', 'Lệ', 'Vân', 'Nhi', 'Quỳnh', 'Nhung',
            'Trang', 'Huệ', 'Duyên', 'Phượng', 'Thương', 'Như', 'Bích', 'Cẩm', 'Mỹ', 'Hoa',
            'Thanh', 'Thu', 'Lý', 'Tiên', 'Yến', 'Hồng', 'Trinh', 'Loan', 'Thắm', 'Hiền',
            'Thùy', 'Châu', 'Ngà', 'Khánh', 'Tú', 'Nhàn', 'Thơm', 'Hoài', 'Tâm', 'Lam'
        ]

        // Try to derive name from email first, fallback to random
        const extractedName = extractNameFromEmail(email)
        let firstName, lastName
        if (extractedName) {
            firstName = extractedName.firstName
            lastName = extractedName.lastName || lastNames[getRandomInt(0, lastNames.length - 1)]
            log('INFO', `Using email-derived name: ${firstName} ${lastName}`)
        } else {
            const useMiddle = Math.random() > 0.45
            const isMale = Math.random() > 0.5
            const givenName = isMale
                ? givenNamesMale[getRandomInt(0, givenNamesMale.length - 1)]
                : givenNamesFemale[getRandomInt(0, givenNamesFemale.length - 1)]
            const middle = middleNames[getRandomInt(0, middleNames.length - 1)]
            firstName = useMiddle ? `${middle} ${givenName}` : givenName
            lastName = lastNames[getRandomInt(0, lastNames.length - 1)]
            log('INFO', `Using random name: ${firstName} ${lastName}`)
        }
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

        // 10a. Check for account creation block screen
        const blockSelectors = [
            'h1:has-text("Account creation has been blocked")',
            'h1:has-text("We can\'t create your account")',
            '[data-testid="title"]:has-text("blocked")',
            '[data-testid="title"]:has-text("unusual activity")',
            'div:has-text("unusual activity and have blocked")',
        ]
        for (const sel of blockSelectors) {
            if (await page.locator(sel).first().isVisible({ timeout: 1500 }).catch(() => false)) {
                log('ERROR', '🚫 Account creation blocked by Microsoft (unusual activity detected)')
                deleteAccount(projectRoot, email, args.dev || false)
                throw new Error('Account creation blocked by Microsoft')
            }
        }

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

            // Verify CAPTCHA was truly solved: page must leave signup form within 20s
            const postCaptchaUrls = [
                'privacynotice.account.microsoft.com',
                'account.live.com',
                'account.microsoft.com',
                'login.live.com',
                'rewards.bing.com',
                'rewards.microsoft.com'
            ]
            log('INFO', 'Verifying CAPTCHA result — waiting for page to advance...')
            let captchaPassed = false
            for (let i = 0; i < 20; i++) {
                const currentUrl = page.url()
                if (postCaptchaUrls.some(u => currentUrl.includes(u))) {
                    log('INFO', `✅ Page advanced to: ${currentUrl}`)
                    captchaPassed = true
                    break
                }
                await page.waitForTimeout(1000)
            }

            if (!captchaPassed) {
                log('ERROR', `CAPTCHA not passed — page still at: ${page.url()}`)
                log('ERROR', 'Deleting account and aborting...')
                await deleteAccount(projectRoot, email, args.dev || false)
                throw new Error('CAPTCHA verification failed: page did not advance after solve attempt')
            }
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
                if (await okButton.isVisible({ timeout: 5000 }).catch(() => false)) {
                    log('INFO', 'Clicking OK on Privacy Notice...')
                    await okButton.click()
                    await page.waitForTimeout(3000)
                    continue // Re-check URL after click
                }
            }



            // --- b1. Handle Edge "Sign in to sync" dialog ---
            try {
                const noThanksBtn = page.locator('button:has-text("No, thanks"), button:has-text("No thanks")').first()
                if (await noThanksBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
                    log('INFO', 'Edge sync dialog detected. Clicking "No, thanks"...')
                    await noThanksBtn.click().catch(() => { })
                    await page.waitForTimeout(1500)
                    continue
                }
            } catch { /* not present */ }

            // --- b2. Handle Passkey / Security Prompts ---
            const passkeyRefused = await handlePasskeyPrompt(page)
            if (passkeyRefused) {
                await page.waitForTimeout(2000)
                continue // Re-check URL after click
            }


            // --- b. Handle Stay Signed In (KMSI) ---
            // Detect via element (not URL) — new signup flow may show this on non-login URLs
            const kmsiDetectors = [
                '[data-testid="kmsiVideo"]',
                'div:has-text("Stay signed in?")',
                'div:has-text("Rester connecté")',
                'input#idSIButton9',
                'input[value="Yes"]'
            ]
            let kmsiDetected = false
            for (const sel of kmsiDetectors) {
                try {
                    if (await page.locator(sel).first().isVisible({ timeout: 1000 }).catch(() => false)) {
                        kmsiDetected = true
                        break
                    }
                } catch { /* try next */ }
            }
            if (kmsiDetected) {
                log('INFO', `Stay Signed In prompt detected at ${url}. Clicking Yes...`)
                // New Fluent UI uses data-testid="primaryButton"; old login uses input#idSIButton9
                const kmsiYesSelectors = [
                    'button[data-testid="primaryButton"]',
                    'input#idSIButton9',
                    'input[value="Yes"]',
                    'button#idSIButton9'
                ]
                let kmsiClicked = false
                for (const sel of kmsiYesSelectors) {
                    try {
                        const btn = page.locator(sel).first()
                        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
                            await btn.scrollIntoViewIfNeeded().catch(() => { })
                            await page.waitForTimeout(getRandomInt(300, 600))
                            try {
                                await btn.click({ timeout: 5000 })
                            } catch {
                                await btn.focus().catch(() => { })
                                await page.keyboard.press('Enter')
                            }
                            await page.waitForTimeout(3000)
                            log('INFO', `After KMSI click, URL: ${page.url()}`)
                            kmsiClicked = true
                            break
                        }
                    } catch { /* try next */ }
                }
                if (!kmsiClicked) log('WARN', 'KMSI detected but could not click Yes button')
                continue
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
        const pwGotoErr = await page.goto('https://account.live.com/password/Change?mkt=en-US&refd=account.microsoft.com&refp=security', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => e)
        if (pwGotoErr instanceof Error) {
            log('WARN', `Password page navigation error: ${pwGotoErr.message} — retrying once...`)
            await page.waitForTimeout(3000)
            await page.goto('https://account.live.com/password/Change?mkt=en-US&refd=account.microsoft.com&refp=security', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { })
        }
        log('INFO', `Password page URL: ${page.url()}`)

        // Wait for "Add/Change password" form — retry up to 15s
        const passwordInput = page.locator('#iPassword')
        const retypeInput = page.locator('#iRetypePassword')
        const saveBtn = page.locator('#UpdatePasswordAction')

        let pwFormFound = false
        for (let attempt = 1; attempt <= 3; attempt++) {
            pwFormFound = await passwordInput.isVisible({ timeout: 5000 }).catch(() => false)
            if (pwFormFound) break
            log('WARN', `Password form not visible (attempt ${attempt}/3), waiting...`)
            await page.waitForTimeout(3000)
        }

        // Nếu vẫn không thấy form — kiểm tra xem có bị chặn ở màn hình KMSI không
        if (!pwFormFound) {
            const kmsiSelectors = [
                '[data-testid="kmsiVideo"]',
                'div:has-text("Stay signed in?")',
                'div:has-text("Rester connecté")',
                'input#idSIButton9',
                'input[value="Yes"]'
            ]
            let kmsiDetectedNow = false
            for (const sel of kmsiSelectors) {
                if (await page.locator(sel).first().isVisible({ timeout: 1500 }).catch(() => false)) {
                    kmsiDetectedNow = true
                    break
                }
            }

            if (kmsiDetectedNow) {
                log('INFO', `KMSI screen detected after password form retries — handling it...`)
                const kmsiYesSelectors = [
                    'button[data-testid="primaryButton"]',
                    'input#idSIButton9',
                    'input[value="Yes"]',
                    'button#idSIButton9'
                ]
                for (const sel of kmsiYesSelectors) {
                    try {
                        const btn = page.locator(sel).first()
                        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
                            await btn.scrollIntoViewIfNeeded().catch(() => { })
                            await page.waitForTimeout(getRandomInt(300, 600))
                            try { await btn.click({ timeout: 5000 }) } catch {
                                await btn.focus().catch(() => { })
                                await page.keyboard.press('Enter')
                            }
                            log('INFO', `KMSI clicked. URL after: ${page.url()}`)
                            await page.waitForTimeout(3000)
                            break
                        }
                    } catch { /* try next */ }
                }

                // Navigate lại trang password và thử thêm lần nữa
                await page.goto('https://account.live.com/password/Change?mkt=en-US&refd=account.microsoft.com&refp=security', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { })
                await page.waitForTimeout(3000)
                log('INFO', `Password page URL after KMSI: ${page.url()}`)
                pwFormFound = await passwordInput.isVisible({ timeout: 8000 }).catch(() => false)
                if (!pwFormFound) log('WARN', `Password form still not found after KMSI handling`)
            }
        }

        if (pwFormFound) {
            log('INFO', 'Form "Add a password" detected. Securing account...')
            await humanType(page, passwordInput, initialAccount.password)
            await page.waitForTimeout(getRandomInt(1000, 2000))
            await humanType(page, retypeInput, initialAccount.password)
            await page.waitForTimeout(getRandomInt(1500, 2500))

            log('INFO', 'Clicking Save password...')
            await fluentUIClick(page, saveBtn)
            await waitForPageStable(page)
            await page.waitForTimeout(getRandomInt(3000, 5000))
        } else {
            log('WARN', `⚠️ Password form NOT found at ${page.url()} — password step SKIPPED`)
        }

        // 11. Activate Microsoft Rewards via Referral
        log('INFO', 'Activating Microsoft Rewards via referral link...')
        await page.goto(urlRef, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => { })
        await waitForPageStable(page)
        await page.waitForTimeout(getRandomInt(2000, 3000))
        log('INFO', `Rewards page URL: ${page.url()}`)

        // Click "Start earning rewards" link
        const startEarningSelector = 'a#start-earning-rewards-link'
        const startEarningVisible = await page.locator(startEarningSelector).isVisible({ timeout: 5000 }).catch(() => false)
        if (startEarningVisible) {
            log('INFO', 'Clicking "Start earning rewards" link...')
            await fluentUIClick(page, startEarningSelector)
            await waitForPageStable(page)
            await page.waitForTimeout(getRandomInt(3000, 5000))
            log('INFO', `After start earning URL: ${page.url()}`)
        } else {
            log('WARN', '"Start earning rewards" link not found — may already be enrolled or page layout changed')
        }

        // Click "Get Rewards now" button/span
        const getRewardsSelectors = [
            'button:has-text("Get Rewards now")',
            'button:has-text("Nhận phần thưởng ngay")',
            'span:has-text("Get Rewards now")',
            'a:has-text("Get Rewards now")',
            '[data-testid*="rewards"] button',
            'button.c-call-to-action'
        ]
        let rewardsClicked = false
        for (const sel of getRewardsSelectors) {
            const visible = await page.locator(sel).first().isVisible({ timeout: 3000 }).catch(() => false)
            if (visible) {
                log('INFO', `Clicking "Get Rewards now" button (${sel})...`)
                await fluentUIClick(page, sel)
                await page.waitForTimeout(getRandomInt(3000, 5000))
                rewardsClicked = true
                break
            }
        }
        if (!rewardsClicked) {
            log('WARN', '"Get Rewards now" button not found — checking if already activated...')
            // Navigate directly to rewards dashboard to confirm enrollment
            await page.goto('https://rewards.bing.com/', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => { })
            await waitForPageStable(page)
            log('INFO', `Rewards dashboard URL: ${page.url()}`)
        }

        // Click reward cards to activate them, then close the popup
        async function clickRewardCard(sectionId) {
            try {
                const section = page.locator(`#${sectionId}, section[id="${sectionId}"]`).first()
                const sectionVisible = await section.isVisible({ timeout: 3000 }).catch(() => false)
                if (!sectionVisible) {
                    log('WARN', `Section #${sectionId} not found, skipping`)
                    return
                }

                // Find the clickable card button inside the section
                // Correct button: bg-bgCtrlNeutralRest + w-sizeCtrlDefault (NOT bg-bgCtrlSubtleRest which is the small icon button)
                const cardBtn = section.locator('button[class*="bg-bgCtrlNeutralRest"]').first()
                const cardVisible = await cardBtn.isVisible({ timeout: 2000 }).catch(() => false)
                if (!cardVisible) {
                    log('WARN', `Card button in #${sectionId} not found, skipping`)
                    return
                }

                log('INFO', `Clicking card in #${sectionId}...`)
                await cardBtn.scrollIntoViewIfNeeded()
                await page.waitForTimeout(getRandomInt(300, 600))

                const box = await cardBtn.boundingBox()
                if (box) {
                    const cx = box.x + box.width / 2
                    const cy = box.y + box.height / 2
                    // Move mouse to element first
                    await page.mouse.move(cx, cy, { steps: getRandomInt(8, 15) })
                    await page.waitForTimeout(getRandomInt(150, 300))
                }

                // Use touch events (most reliable for Angular PWA/mobile-style components)
                await cardBtn.evaluate((el) => {
                    const rect = el.getBoundingClientRect()
                    const cx = rect.left + rect.width / 2
                    const cy = rect.top + rect.height / 2
                    const touch = new Touch({ identifier: Date.now(), target: el, clientX: cx, clientY: cy, pageX: cx, pageY: cy, screenX: cx, screenY: cy, radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1 })
                    const touchInit = { bubbles: true, cancelable: true, view: window, touches: [touch], targetTouches: [touch], changedTouches: [touch] }
                    el.dispatchEvent(new TouchEvent('touchstart', touchInit))
                    el.dispatchEvent(new TouchEvent('touchend', { ...touchInit, touches: [], targetTouches: [] }))
                    // Also fire click for fallback
                    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy }))
                })
                await page.waitForTimeout(getRandomInt(4500, 5500))

                // Close the popup — also use real mouse click
                const closeSelectors = [
                    'button[slot="close"]',
                    '[slot="close"]',
                    'button[aria-label="Close"]',
                    'button[aria-label="Đóng"]',
                    'button[aria-label="close"]',
                    '.close-icon button',
                    'button.ms-Button--icon[title="Close"]'
                ]
                let popupClosed = false
                for (const sel of closeSelectors) {
                    const closeBtn = page.locator(sel).first()
                    if (await closeBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
                        const cbox = await closeBtn.boundingBox()
                        if (cbox) {
                            await page.mouse.move(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2, { steps: 5 })
                            await page.waitForTimeout(200)
                            await page.mouse.click(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2)
                        } else {
                            await closeBtn.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })))
                        }
                        log('INFO', `Closing popup from #${sectionId} (${sel})`)
                        await page.waitForTimeout(getRandomInt(1000, 1800))
                        popupClosed = true
                        break
                    }
                }
                if (!popupClosed) {
                    log('WARN', `Close button not found for #${sectionId} popup, pressing Escape`)
                    await page.keyboard.press('Escape')
                    await page.waitForTimeout(1000)
                }
            } catch (e) {
                log('WARN', `Error handling section #${sectionId}: ${e.message}`)
            }
        }

        for (const sectionId of ['snapshot', 'dailyset', 'streaks', 'achievements']) {
            await clickRewardCard(sectionId)
        }

        // Redeem SKU page
        log('INFO', 'Navigating to rewards redeem SKU page...')
        await page.goto('https://rewards.bing.com/redeem/sku/000899012002', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { })
        await page.waitForTimeout(getRandomInt(3000, 5000))
        log('INFO', `SKU page URL: ${page.url()}`)

        const dispatchTouchClick = async (el) => {
            await el.scrollIntoViewIfNeeded().catch(() => { })
            await page.waitForTimeout(getRandomInt(200, 400))
            await el.evaluate((node) => {
                const rect = node.getBoundingClientRect()
                const cx = rect.left + rect.width / 2
                const cy = rect.top + rect.height / 2
                const touch = new Touch({ identifier: Date.now(), target: node, clientX: cx, clientY: cy, pageX: cx, pageY: cy, screenX: cx, screenY: cy, radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1 })
                const init = { bubbles: true, cancelable: true, view: window, touches: [touch], targetTouches: [touch], changedTouches: [touch] }
                node.dispatchEvent(new TouchEvent('touchstart', init))
                node.dispatchEvent(new TouchEvent('touchend', { ...init, touches: [], targetTouches: [] }))
                node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy }))
            })
            await page.waitForTimeout(getRandomInt(500, 900))
        }

        // Step 1: Click toggle switch (ctrlChoiceSwitch) — optional pre-redeem toggle
        const toggleSwitch = page.locator('div[class*="ctrlChoiceSwitchBgDefault"]').first()
        if (await toggleSwitch.isVisible({ timeout: 5000 }).catch(() => false)) {
            log('INFO', 'Clicking toggle switch...')
            await dispatchTouchClick(toggleSwitch)
        } else {
            log('WARN', 'Toggle switch not found on SKU page')
        }

        // Step 2: Select "Track and manually redeem your reward" (value="Goal")
        // The radio is inside a React-Aria popup; we target the label or input with value="Goal"
        const goalRadioInput = page.locator('input[type="radio"][value="Goal"]').first()
        const goalRadioLabel = page.locator('label:has-text("Track and manually redeem your reward")').first()

        if (await goalRadioInput.isVisible({ timeout: 5000 }).catch(() => false)) {
            log('INFO', 'Selecting "Track and manually redeem your reward" (Goal)...')
            // Click the associated label for better React-Aria handling
            if (await goalRadioLabel.isVisible({ timeout: 3000 }).catch(() => false)) {
                await dispatchTouchClick(goalRadioLabel)
            } else {
                await dispatchTouchClick(goalRadioInput)
            }
            await page.waitForTimeout(getRandomInt(800, 1200))
        } else {
            log('WARN', '"Goal" radio option not found, falling back to first radio indicator')
            const fallbackRadio = page.locator('div[data-indicator="true"][class*="ctrlChoiceRadio"]').first()
            if (await fallbackRadio.isVisible({ timeout: 3000 }).catch(() => false)) {
                await dispatchTouchClick(fallbackRadio)
                await page.waitForTimeout(getRandomInt(800, 1200))
            }
        }

        // Step 3: Click Next button (wait for it to become enabled)
        const nextBtn = page.locator('button[class*="bg-bgCtrlBrandRest"]:has-text("Next"), button:has-text("Next")').first()
        if (await nextBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
            // Wait for disabled attribute to be removed
            try {
                await page.waitForFunction(() => {
                    const btn = document.querySelector('button[class*="bg-bgCtrlBrandRest"], button:has-text("Next")')
                    return btn && !btn.disabled
                }, { timeout: 5000 })
            } catch {
                log('WARN', 'Next button may still be disabled, proceeding anyway')
            }
            log('INFO', 'Clicking Next button on SKU page...')
            await dispatchTouchClick(nextBtn)
            await page.waitForTimeout(getRandomInt(3000, 5000))
            log('INFO', `After Next, URL: ${page.url()}`)
        } else {
            log('WARN', 'Next button not found on SKU page')
        }

        // Step 4: Dismiss "Your Rewards goal is set" popup
        const okayBtn = page.locator('button:has-text("Okay"), button:has-text("OK")').first()
        if (await okayBtn.isVisible({ timeout: 6000 }).catch(() => false)) {
            log('INFO', '"Your Rewards goal is set" popup detected. Clicking Okay...')
            await dispatchTouchClick(okayBtn)
            await page.waitForTimeout(getRandomInt(1500, 2500))
            log('INFO', '✅ Rewards goal popup dismissed')
        } else {
            log('WARN', '"Rewards goal" popup Okay button not found — may not have appeared')
        }

        // Step 5: Dashboard referral clicks for extra points
        log('INFO', 'Navigating to Rewards dashboard for referral clicks...')
        await page.goto('https://rewards.bing.com/dashboard?ref=rewardspanel', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { })
        await waitForPageStable(page)
        await page.waitForTimeout(getRandomInt(2000, 3500))

        // First round: click "Earn 1320 points" then /earn
        const earnPointsSpan1 = page.locator('span:has-text("Earn 1320 points")').first()
        if (await earnPointsSpan1.isVisible({ timeout: 5000 }).catch(() => false)) {
            log('INFO', 'Clicking "Earn 1320 points" span (round 1)...')
            await dispatchTouchClick(earnPointsSpan1)
            await page.waitForTimeout(getRandomInt(1500, 2500))

            const earnLink1 = page.locator('a[href="/earn"]').first()
            if (await earnLink1.isVisible({ timeout: 5000 }).catch(() => false)) {
                log('INFO', 'Clicking /earn link (round 1)...')
                await dispatchTouchClick(earnLink1)
                await page.waitForTimeout(5000)
            } else {
                log('WARN', '/earn link not found (round 1)')
            }
        } else {
            log('WARN', '"Earn 1320 points" span not found (round 1)')
        }

        // Return to dashboard
        log('INFO', 'Returning to dashboard for second round...')
        await page.goto('https://rewards.bing.com/dashboard?ref=rewardspanel', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { })
        await waitForPageStable(page)
        await page.waitForTimeout(getRandomInt(2000, 3500))

        // Second round: click "Earn 1320 points" then /about?section=benefits
        const earnPointsSpan2 = page.locator('span:has-text("Earn 1320 points")').first()
        if (await earnPointsSpan2.isVisible({ timeout: 5000 }).catch(() => false)) {
            log('INFO', 'Clicking "Earn 1320 points" span (round 2)...')
            await dispatchTouchClick(earnPointsSpan2)
            await page.waitForTimeout(getRandomInt(1500, 2500))

            const benefitsLink = page.locator('a[href="/about?section=benefits"]').first()
            if (await benefitsLink.isVisible({ timeout: 5000 }).catch(() => false)) {
                log('INFO', 'Clicking /about?section=benefits link (round 2)...')
                await dispatchTouchClick(benefitsLink)
                await page.waitForTimeout(5000)
            } else {
                log('WARN', '/about?section=benefits link not found (round 2)')
            }
        } else {
            log('WARN', '"Earn 1320 points" span not found (round 2)')
        }

        // Return to dashboard final time
        log('INFO', 'Returning to dashboard (final)...')
        await page.goto('https://rewards.bing.com/dashboard?ref=rewardspanel', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { })
        await waitForPageStable(page)
        await page.waitForTimeout(getRandomInt(1500, 2500))

        log('SUCCESS', '✅ Registration and Rewards activation completed!')

        log('INFO', 'Saving session and closing browser...')
        await persistSessionData()
        releaseProxyLock(proxyKey, projectRoot)
        if (browser?.isConnected?.()) {
            await browser.close()
        }
        log('SUCCESS', 'Session saved. Process complete.')
        return { success: true }

    } catch (e) {
        log('ERROR', `Flow failed: ${e.message}`)
        releaseProxyLock(proxyKey, projectRoot)
        if (browser?.isConnected?.()) {
            await browser.close()
        }
        return { success: false, error: e.message }
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
 * Detects and refuses passkey/WebAuthn setup prompts.
 * Separates detection selectors from refuse selectors to avoid false positives.
 * Returns true if a passkey prompt was found and handled, false otherwise.
 */
async function handlePasskeyPrompt(page) {
    // Detection selectors: only content that specifically indicates a passkey page
    const passkeyDetectionSelectors = [
        '[data-testid*="passkey"]',
        '[data-testid="biometricVideo"]',
        '[data-testid="registrationImg"]',
        'div:has-text("Set up a passkey")',
        'div:has-text("Tạo khóa truy cập")',
        'div:has-text("passkey")',
        'div:has-text("clé d\'accès")',
        'div:has-text("Configurer une clé")',
        'div:has-text("Giữ thông tin của bạn an toàn")',
        'div:has-text("Keep your info safe")'
    ]

    let passkeyPromptFound = false
    for (const selector of passkeyDetectionSelectors) {
        const element = page.locator(selector).first()
        if (await element.isVisible({ timeout: 500 }).catch(() => false)) {
            passkeyPromptFound = true
            log('WARN', `⚠️ Passkey prompt detected (selector: ${selector}) - REFUSING...`)
            break
        }
    }

    if (!passkeyPromptFound) return false

    // Refuse selectors: buttons to click to dismiss the passkey prompt
    const refuseButtonSelectors = [
        'button:has-text("Skip")',
        'button:has-text("Not now")',
        'button:has-text("Bỏ qua")',
        'button:has-text("Để sau")',
        'button:has-text("No")',
        'button:has-text("Cancel")',
        'button:has-text("Ignorer")',
        'button:has-text("Plus tard")',
        'button:has-text("Non")',
        'button:has-text("Annuler")',
        'button[data-testid="secondaryButton"]',
        'button[id*="cancel"]',
        'button[id*="skip"]'
    ]

    for (const selector of refuseButtonSelectors) {
        const btn = page.locator(selector).first()
        if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
            log('INFO', `Clicking passkey refuse button: ${selector}`)
            await fluentUIClick(page, btn)
            log('INFO', '✅ Passkey setup REFUSED')
            return true
        }
    }

    log('WARN', '⚠️ Passkey prompt found but no refuse button detected')
    return true // Still return true to re-check URL
}

/**
 * Automates the "Press and Hold" CAPTCHA (PerimeterX / HUMAN Security via hsprotect.net)
 *
 * HTML structure:
 *   - Outer page has: <iframe title="Verification challenge" data-testid="humanCaptchaIframe" src="https://iframe.hsprotect.net/...">
 *   - Inside that iframe is the hold button
 *   - Playwright CAN interact via page.frames() even cross-origin (CDP bypass)
 */
async function solveArkosePressAndHold(page) {
    log('INFO', 'Attempting to solve "Press and Hold" CAPTCHA (PerimeterX/HUMAN Security)...')

    try {
        // Correct selector based on actual HTML (title="Verification challenge", NOT "Human verification challenge")
        const outerFrameSelector = 'iframe[data-testid="humanCaptchaIframe"], iframe[title="Verification challenge"], iframe[title="Human verification challenge"]'
        await page.waitForSelector(outerFrameSelector, { state: 'visible', timeout: 15000 })
        log('INFO', 'CAPTCHA iframe detected')

        await page.waitForTimeout(getRandomInt(1500, 2500)) // Let iframe load

        // --- Strategy 1: Interact inside the iframe via Playwright frame API ---
        // Playwright can access cross-origin iframes directly via page.frames()
        // The hold button selectors for PerimeterX/HUMAN Security
        const holdSelectors = [
            '#home_children_button',   // PerimeterX common
            '#Tay_nhan_giu',           // Vietnamese variant
            'button[id*="hold"]',
            'button[id*="press"]',
            '[aria-label*="hold"]',
            '[aria-label*="press"]',
            'button:has-text("Press and hold")',
            'div[role="button"]',
            'button'                   // Last resort: first button in iframe
        ]

        // Find the challenge frame (hsprotect.net with ch_ctx=1)
        let challengeFrame = null
        for (const frame of page.frames()) {
            const url = frame.url()
            if (url.includes('hsprotect.net') && url.includes('ch_ctx')) {
                challengeFrame = frame
                log('INFO', `Found challenge frame: ${url.substring(0, 80)}...`)
                break
            }
        }

        // Fallback: any hsprotect frame
        if (!challengeFrame) {
            for (const frame of page.frames()) {
                if (frame.url().includes('hsprotect.net')) {
                    challengeFrame = frame
                    log('INFO', `Found hsprotect frame (fallback): ${frame.url().substring(0, 80)}...`)
                    break
                }
            }
        }

        if (challengeFrame) {
            // Wait for frame to be fully loaded
            await challengeFrame.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => { })
            await page.waitForTimeout(getRandomInt(1000, 2000))

            // --- Strategy 1: Accessibility bypass ---
            // "Accessible challenge" button is on the OUTER PAGE, not inside the iframe
            const accessibilitySelectors = [
                'button:has-text("Accessible challenge")',
                '[aria-label="Accessible challenge"]',
                '[data-testid="accessibleImg"]',       // img inside the button
                'button:has([data-testid="accessibleImg"])',
                'img[data-testid="accessibleImg"]',
                // Fallback: check inside iframe too
                'button[aria-label="Accessibility"]',
                'button[aria-label*="ccessib"]',
                '#accessibility_button',
                'button[id*="accessibility"]'
            ]

            let accessibilityClicked = false
            // Search on OUTER page first
            for (const sel of accessibilitySelectors.slice(0, 5)) {
                try {
                    const el = page.locator(sel).first()
                    if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
                        log('INFO', `Accessibility button found on outer page (${sel}), clicking...`)
                        await el.click()
                        await page.waitForTimeout(getRandomInt(1500, 2500))
                        accessibilityClicked = true
                        break
                    }
                } catch (e) { /* try next */ }
            }

            // Fallback: search inside iframe
            if (!accessibilityClicked) {
                for (const sel of accessibilitySelectors.slice(5)) {
                    try {
                        const el = await challengeFrame.$(sel)
                        if (el && await el.isVisible()) {
                            log('INFO', `Accessibility button found inside iframe (${sel}), clicking...`)
                            await el.click()
                            await page.waitForTimeout(getRandomInt(1500, 2500))
                            accessibilityClicked = true
                            break
                        }
                    } catch (e) { /* try next */ }
                }
            }

            if (accessibilityClicked) {
                // After accessibility click, look for "Press Again" / confirm button
                // This button can be on outer page OR inside iframe
                const pressAgainSelectors = [
                    'button:has-text("Press Again")',
                    'button:has-text("Press again")',
                    'button:has-text("Nhấn lại")',
                    'button:has-text("Confirm")',
                    'button:has-text("Verify")',
                    'button:has-text("Xác nhận")',
                    '#verify_button',
                    'button[id*="verify"]'
                ]

                for (let attempt = 1; attempt <= 2; attempt++) {
                    // Check outer page first
                    for (const sel of pressAgainSelectors) {
                        try {
                            const btn = page.locator(sel).first()
                            if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
                                log('INFO', `"Press Again" found on outer page (${sel}), clicking...`)
                                await btn.click()
                                await page.waitForTimeout(getRandomInt(2000, 3000))
                                log('INFO', '✅ Accessibility captcha bypass done')
                                return true
                            }
                        } catch (e) { /* try next */ }
                    }
                    // Check inside iframe
                    for (const sel of pressAgainSelectors) {
                        try {
                            const btn = await challengeFrame.$(sel)
                            if (btn && await btn.isVisible()) {
                                log('INFO', `"Press Again" found inside iframe (${sel}), clicking...`)
                                await btn.click()
                                await page.waitForTimeout(getRandomInt(2000, 3000))
                                log('INFO', '✅ Accessibility captcha bypass done')
                                return true
                            }
                        } catch (e) { /* try next */ }
                    }
                    log('WARN', `"Press Again" not found (attempt ${attempt}/4), waiting...`)
                    await page.waitForTimeout(1500)
                }

                log('WARN', '"Press Again" not found after accessibility click — falling back to hold')
            } else {
                log('WARN', 'Accessibility button not found — trying press and hold')
            }

            // --- Strategy 2: Press and Hold inside iframe ---
            for (const selector of holdSelectors) {
                try {
                    const el = await challengeFrame.$(selector)
                    if (el && await el.isVisible()) {
                        log('INFO', `Hold button found inside iframe: ${selector}`)

                        const box = await el.boundingBox()
                        if (!box) continue

                        const iframeEl = await page.$(outerFrameSelector)
                        const iframeBox = await iframeEl?.boundingBox()

                        const pageX = (iframeBox?.x ?? 0) + box.x + box.width / 2 + getRandomInt(-3, 3)
                        const pageY = (iframeBox?.y ?? 0) + box.y + box.height / 2 + getRandomInt(-3, 3)

                        log('INFO', `Moving to hold position: (${pageX.toFixed(0)}, ${pageY.toFixed(0)})`)
                        await page.mouse.move(pageX, pageY, { steps: getRandomInt(10, 20) })
                        await page.waitForTimeout(getRandomInt(300, 700))
                        await page.mouse.down()

                        const holdDuration = getRandomInt(8500, 12000)
                        log('INFO', `Holding for ${(holdDuration / 1000).toFixed(1)} seconds...`)
                        await page.waitForTimeout(holdDuration)
                        await page.mouse.up()

                        await page.waitForTimeout(getRandomInt(2000, 3500))
                        return true
                    }
                } catch (e) { /* try next selector */ }
            }

            log('WARN', 'Hold button not found inside iframe. Falling back to center hold...')
        } else {
            log('WARN', 'Could not get challengeFrame via page.frames(). Falling back to bounding box hold...')
        }

        // --- Strategy 3: Fallback - Hold center of iframe bounding box ---
        const iframeEl = await page.$(outerFrameSelector)
        const iframeBox = await iframeEl?.boundingBox()
        if (iframeBox) {
            const centerX = iframeBox.x + iframeBox.width / 2 + getRandomInt(-5, 5)
            const centerY = iframeBox.y + iframeBox.height / 2 + getRandomInt(-5, 5)

            log('INFO', `Fallback: Holding iframe center (${centerX.toFixed(0)}, ${centerY.toFixed(0)})`)
            await page.mouse.move(centerX, centerY, { steps: getRandomInt(10, 15) })
            await page.waitForTimeout(getRandomInt(300, 600))
            await page.mouse.down()

            const holdDuration = getRandomInt(9000, 12000)
            log('INFO', `Holding for ${(holdDuration / 1000).toFixed(1)} seconds...`)
            await page.waitForTimeout(holdDuration)
            await page.mouse.up()

            await page.waitForTimeout(getRandomInt(2000, 3000))
            return true
        }

        log('ERROR', 'Could not determine iframe position for captcha hold')
        return false
    } catch (e) {
        log('ERROR', `Error in solveArkosePressAndHold: ${e.message}`)
        return false
    }
}

// Entry point — supports -slot N to create multiple accounts sequentially
; (async () => {
    const slots = parseInt(args.slot) || 1
    let succeeded = 0
    let failed = 0

    for (let i = 1; i <= slots; i++) {
        if (slots > 1) log('INFO', `--- Slot ${i}/${slots} ---`)
        try {
            const result = await main()
            if (result?.success) {
                succeeded++
            } else {
                failed++
                log('WARN', `Slot ${i} failed: ${result?.error || 'unknown error'}`)
            }
        } catch (err) {
            failed++
            log('ERROR', `Slot ${i} fatal error: ${err.message}`)
        }
        if (i < slots) await new Promise(r => setTimeout(r, 3000))
    }

    if (slots > 1) log('INFO', `Done: ${succeeded} succeeded, ${failed} failed out of ${slots} slots`)
    process.exit(failed > 0 && succeeded === 0 ? 1 : 0)
})()
