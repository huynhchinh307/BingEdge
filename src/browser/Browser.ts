import patchright, { type BrowserContext } from 'patchright'
import { newInjectedContext } from 'fingerprint-injector'
import { BrowserFingerprintWithHeaders, FingerprintGenerator } from 'fingerprint-generator'
import fs from 'fs'
import path from 'path'

import type { MicrosoftRewardsBot } from '../index'
import { loadSessionData, saveFingerprintData } from '../util/Load'
import { UserAgentManager } from './UserAgent'
import AxiosClient from '../util/Axios'

import type { Account, AccountProxy } from '../interface/Account'

/* Test Stuff
https://abrahamjuliot.github.io/creepjs/
https://botcheck.luminati.io/
https://fv.pro/
https://pixelscan.net/
https://www.browserscan.net/
*/

interface BrowserCreationResult {
    browser: any
    context: BrowserContext
    fingerprint: BrowserFingerprintWithHeaders
}

class Browser {
    private readonly bot: MicrosoftRewardsBot
    private static readonly BROWSER_ARGS = [
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
        '--disable-save-password-bubble'
    ] as const

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    async createBrowser(account: Account): Promise<BrowserCreationResult> {
        let browser: any
        try {
            let bypassString = undefined
            const bypassFilePath = path.join(process.cwd(), 'bypass.txt')

            if (fs.existsSync(bypassFilePath)) {
                try {
                    const bypassContent = fs.readFileSync(bypassFilePath, 'utf8').trim()
                    if (bypassContent) {
                        bypassString = bypassContent
                    }
                } catch (e: any) {
                    this.bot.logger.warn(this.bot.isMobile, 'BROWSER', `Failed to read bypass.txt: ${e.message}`)
                }
            }

            const proxyConfig = account.proxy.url
                ? {
                      server: this.formatProxyServer(account.proxy),
                      bypass: bypassString,
                      ...(account.proxy.username &&
                          account.proxy.password && {
                              username: account.proxy.username,
                              password: account.proxy.password
                          })
                  }
                : undefined

            this.bot.logger.info(
                this.bot.isMobile, 
                'BROWSER', 
                `Launching stealth browser (Patchright)`
            )

            browser = await patchright.chromium.launch({
                headless: this.bot.config.headless,
                ...(proxyConfig && { proxy: proxyConfig }),
                args: [...Browser.BROWSER_ARGS]
            })
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            this.bot.logger.error(this.bot.isMobile, 'BROWSER', `Launch failed: ${errorMessage}`)
            throw error
        }

        try {
            const sessionData = await loadSessionData(
                this.bot.config.sessionPath,
                account.email,
                account.saveFingerprint,
                this.bot.isMobile
            )

            const fingerprint = sessionData.fingerprint ?? (await this.generateFingerprint(this.bot.isMobile))

            const locale = account.geoLocale === 'auto' ? 'en-US' : `${account.geoLocale.toLowerCase()}-${account.geoLocale.toUpperCase()}`

            this.bot.logger.info(this.bot.isMobile, 'BROWSER', `Syncing location and timezone with IP...`)
            const ipLocation = await this.getIpLocation(account.proxy)

            const context = await newInjectedContext(browser as any, {
                fingerprint,
                newContextOptions: {
                    locale,
                    timezoneId: ipLocation?.timezone,
                    geolocation: ipLocation ? { latitude: ipLocation.lat, longitude: ipLocation.lon } : undefined,
                    bypassCSP: true,
                    ignoreHTTPSErrors: true,
                    permissions: ['geolocation']
                }
            })

            await context.addInitScript((locationData) => {
                // Mock Geolocation
                if (locationData) {
                    const { latitude, longitude } = locationData;
                    navigator.geolocation.getCurrentPosition = (success) => {
                        success({
                            coords: {
                                latitude,
                                longitude,
                                accuracy: 100,
                                altitude: null,
                                altitudeAccuracy: null,
                                heading: null,
                                speed: null,
                            },
                            timestamp: Date.now(),
                        } as any);
                    };
                    
                    navigator.geolocation.watchPosition = (success) => {
                        success({
                            coords: {
                                latitude,
                                longitude,
                                accuracy: 100,
                                altitude: null,
                                altitudeAccuracy: null,
                                heading: null,
                                speed: null,
                            },
                            timestamp: Date.now(),
                        } as any);
                        return 1337; // Dummy ID
                    };
                }

                // Disable Credentials
                Object.defineProperty(navigator, 'credentials', {
                    value: {
                        create: () => Promise.reject(new Error('WebAuthn disabled')),
                        get: () => Promise.reject(new Error('WebAuthn disabled'))
                    }
                })
            }, ipLocation ? { latitude: ipLocation.lat, longitude: ipLocation.lon } : null)

            // Grant permissions explicitly for common domains
            await context.grantPermissions(['geolocation'], { origin: 'https://rewards.bing.com' })
            await context.grantPermissions(['geolocation'], { origin: 'https://www.bing.com' })
            await context.grantPermissions(['geolocation'], { origin: 'https://microsoft.com' })

            context.setDefaultTimeout(this.bot.utils.stringToNumber(this.bot.config?.globalTimeout ?? 30000))

            await context.addCookies(sessionData.cookies)

            if (
                (account.saveFingerprint.mobile && this.bot.isMobile) ||
                (account.saveFingerprint.desktop && !this.bot.isMobile)
            ) {
                await saveFingerprintData(this.bot.config.sessionPath, account.email, this.bot.isMobile, fingerprint)
            }

            this.bot.logger.info(
                this.bot.isMobile,
                'BROWSER',
                `Created browser with User-Agent: "${fingerprint.fingerprint.navigator.userAgent}"`
            )
            this.bot.logger.debug(this.bot.isMobile, 'BROWSER-FINGERPRINT', JSON.stringify(fingerprint))

            return { browser, context: context as unknown as BrowserContext, fingerprint }
        } catch (error) {
            await browser.close().catch(() => {})
            throw error
        }
    }

    private formatProxyServer(proxy: AccountProxy): string {
        try {
            const urlObj = new URL(proxy.url)
            const protocol = urlObj.protocol.replace(':', '')
            return `${protocol}://${urlObj.hostname}:${proxy.port}`
        } catch {
            return `${proxy.url}:${proxy.port}`
        }
    }

    private async getIpLocation(proxy: AccountProxy) {
        // Force proxy usage for this check to get the location of the proxy IP
        const axios = new AxiosClient({ ...proxy, proxyAxios: true })
        try {
            // Using ip-api.com (HTTP) because proxy might not support HTTPS easily or to avoid cert issues for this simple check
            const response = await axios.request({
                url: 'http://ip-api.com/json',
                method: 'GET',
                timeout: 10000
            })
            
            const data = response.data
            if (data.status === 'success') {
                this.bot.logger.debug(this.bot.isMobile, 'BROWSER-IP-LOC', `Detected: ${data.city}, ${data.country} (${data.lat}, ${data.lon}) | Timezone: ${data.timezone}`)
                return {
                    lat: data.lat,
                    lon: data.lon,
                    timezone: data.timezone
                }
            } else {
                this.bot.logger.warn(this.bot.isMobile, 'BROWSER-IP-LOC', `Failed to get IP location: ${data.message || 'Unknown error'}`)
            }
        } catch (error: any) {
            this.bot.logger.warn(this.bot.isMobile, 'BROWSER-IP-LOC', `Failed to fetch IP location: ${error.message}`)
        }
        return null
    }

    async generateFingerprint(isMobile: boolean) {
        const browserType = this.bot.config.browserType ?? 'chromium'
        const fingerprintBrowser = browserType === 'edge' ? 'edge' : 'chrome'

        const fingerPrintData = new FingerprintGenerator().getFingerprint({
            devices: isMobile ? ['mobile'] : ['desktop'],
            operatingSystems: isMobile ? ['android', 'ios'] : ['windows', 'macos', 'linux'],
            browsers: [fingerprintBrowser],
            ...(isMobile ? {} : {
                screen: {
                    minWidth: 1366,
                    maxWidth: 1920,
                    minHeight: 768,
                    maxHeight: 1080
                }
            })
        })

        const userAgentManager = new UserAgentManager(this.bot)
        const updatedFingerPrintData = await userAgentManager.updateFingerprintUserAgent(fingerPrintData, isMobile)

        return updatedFingerPrintData
    }
}

export default Browser

