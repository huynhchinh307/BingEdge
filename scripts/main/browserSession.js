import fs from 'fs'
import { chromium } from 'patchright'
import { newInjectedContext } from 'fingerprint-injector'
import { FingerprintGenerator } from 'fingerprint-generator'
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

async function getIpLocation(proxyConfig) {
    const { default: axios } = await import('axios')
    let axiosAgent = null

    if (proxyConfig && proxyConfig.server) {
        const { HttpsProxyAgent } = await import('https-proxy-agent')
        const { HttpProxyAgent } = await import('http-proxy-agent')
        const { SocksProxyAgent } = await import('socks-proxy-agent')
        
        const serverUrl = proxyConfig.server.includes('://') ? proxyConfig.server : `http://${proxyConfig.server}`
        const urlObj = new URL(serverUrl)
        
        let proxyUrl = serverUrl
        if (proxyConfig.username && proxyConfig.password) {
            proxyUrl = `${urlObj.protocol}//${encodeURIComponent(proxyConfig.username)}:${encodeURIComponent(proxyConfig.password)}@${urlObj.host}`
        }

        if (urlObj.protocol === 'socks4:' || urlObj.protocol === 'socks5:') {
            axiosAgent = new SocksProxyAgent(proxyUrl)
        } else if (urlObj.protocol === 'https:') {
            axiosAgent = new HttpsProxyAgent(proxyUrl)
        } else {
            axiosAgent = new HttpProxyAgent(proxyUrl)
        }
    }

    const services = [
        'http://v6.ipify.org?format=json',
        'http://api64.ipify.org?format=json',
        'http://ip.nf/me.json',
        'http://ip-api.com/json'
    ]

    for (const url of services) {
        try {
            const response = await axios.get(url, {
                httpsAgent: axiosAgent,
                httpAgent: axiosAgent,
                timeout: 15000, // Tăng lên 15s cho Proxy v6 chậm
                headers: { 'User-Agent': 'Mozilla/5.0' }
            })
            
            if (response.data) {
                const d = response.data
                const data = {
                    lat: parseFloat(d.ip?.latitude || d.lat || d.latitude || 0),
                    lon: parseFloat(d.ip?.longitude || d.lon || d.longitude || 0),
                    timezone: d.ip?.timezone || d.timezone || 'UTC'
                }
                if (data.lat !== 0 || data.timezone !== 'UTC') {
                    return data
                }
            }
        } catch (e) {
            continue
        }
    }
    return null
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
                const { UserAgentManager } = await import('../../dist/browser/UserAgent.js')
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

    if (account.proxy && account.proxy.url && (!proxy || !proxy.server)) {
        log('ERROR', 'Proxy is configured in account but proxy data is invalid or incomplete')
        log('ERROR', 'Account proxy config:', JSON.stringify(account.proxy, null, 2))
        log('ERROR', 'Required fields: proxy.url, proxy.port')
        log('ERROR', 'Cannot start browser without proxy when it is explicitly configured')
        process.exit(1)
    }

    const userAgent = fingerprint?.fingerprint?.navigator?.userAgent || fingerprint?.fingerprint?.userAgent || null

    const browserType = config.browserType ?? 'chromium'
    const getEdgeExecutable = () => {
        const edgePaths = {
            win32: [
                'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
                'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
                `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`
            ],
            linux: [
                '/usr/bin/microsoft-edge',
                '/usr/bin/microsoft-edge-stable',
                '/opt/microsoft/msedge/msedge'
            ],
            darwin: [
                '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
            ]
        }
        const paths = edgePaths[process.platform] ?? []
        return paths.find(p => fs.existsSync(p))
    }

    const edgePath = browserType === 'edge' ? getEdgeExecutable() : undefined

    log('INFO', `Session: ${args.email} (${sessionType})`)
    log('INFO', `  Cookies: ${cookies.length}`)
    log('INFO', `  Fingerprint: ${fingerprint ? 'Yes' : 'No'}`)
    log('INFO', `  User-Agent: ${userAgent || 'Default'}`)
    log('INFO', `  Proxy: ${proxy ? 'Yes' : 'No'}`)
    log('INFO', `Launching ${edgePath ? 'Microsoft Edge' : 'browser'}...`)

    const browser = await chromium.launch({
        headless: false,
        ...(proxy ? { proxy } : {}),
        ...(edgePath && { executablePath: edgePath }),
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

    log('INFO', 'Syncing location and timezone with IP...')
    const ipLocation = await getIpLocation(proxy)
    if (ipLocation) {
        log('INFO', `  Detected: ${ipLocation.lat}, ${ipLocation.lon} | Timezone: ${ipLocation.timezone}`)
    }

    let context
    if (fingerprint) {
        context = await newInjectedContext(browser, { 
            fingerprint,
            newContextOptions: {
                timezoneId: ipLocation?.timezone,
                geolocation: ipLocation ? { latitude: ipLocation.lat, longitude: ipLocation.lon } : undefined,
                permissions: ['geolocation']
            }
        })

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
                    clearWatch: () => {},
                };
                
                // Ghi đè thực sự navigator.geolocation
                Object.defineProperty(navigator, 'geolocation', {
                    value: mockGeo,
                    configurable: true,
                    enumerable: true,
                    writable: true
                });
                
                // Vô hiệu hóa WebAuthn
                Object.defineProperty(navigator, 'credentials', {
                    value: {
                        create: () => Promise.reject(new Error('WebAuthn disabled')),
                        get: () => Promise.reject(new Error('WebAuthn disabled'))
                    }
                });
            }, { latitude: ipLocation.lat, longitude: ipLocation.lon })
        }

        // Cấp quyền cho các domain quan trọng
        await context.grantPermissions(['geolocation'], { origin: 'https://rewards.bing.com' })
        await context.grantPermissions(['geolocation'], { origin: 'https://www.bing.com' })
        await context.grantPermissions(['geolocation'], { origin: 'https://microsoft.com' })
        await context.grantPermissions(['geolocation'], { origin: 'https://rewards.microsoft.com' })

        log('SUCCESS', 'Fingerprint injected into browser context')
    } else {
        context = await browser.newContext({
            viewport: args.mobile ? { width: 375, height: 667 } : { width: 1366, height: 768 },
            timezoneId: ipLocation?.timezone,
            geolocation: ipLocation ? { latitude: ipLocation.lat, longitude: ipLocation.lon } : undefined,
            permissions: ['geolocation']
        })
    }

    if (cookies.length) {
        await context.addCookies(cookies)
        log('INFO', `Added ${cookies.length} cookies to context`)
    }

    const page = await context.newPage()

    try {
        // Luôn mở trang trắng theo yêu cầu của người dùng
        await page.goto('about:blank')
        log('SUCCESS', 'Browser opened with blank page')
    } catch (e) {
        log('WARN', `Could not open blank page: ${e.message}`)
    }

    log('SUCCESS', 'Browser session is ready')
    log('INFO', 'Browser is at about:blank. You can now type your URL manually.')

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