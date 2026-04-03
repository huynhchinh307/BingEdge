import { chromium, type Browser as PatchrightBrowser, type BrowserContext } from 'patchright'
import { BrowserFingerprintWithHeaders, FingerprintGenerator } from 'fingerprint-generator'

import type { MicrosoftRewardsBot } from '../index'
import { loadSessionData, saveFingerprintData } from '../util/Load'
import { UserAgentManager } from './UserAgent'

import type { Account, AccountProxy } from '../interface/Account'

/* Test Stuff
https://abrahamjuliot.github.io/creepjs/
https://botcheck.luminati.io/
https://fv.pro/
https://pixelscan.net/
https://www.browserscan.net/
*/

interface BrowserCreationResult {
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
        '--disable-user-media-security=true',
        '--disable-blink-features=Attestation',
        '--disable-features=WebAuthentication,PasswordManagerOnboarding,PasswordManager,EnablePasswordsAccountStorage,Passkeys',
        '--disable-save-password-bubble',
        '--disable-infobars'
    ] as const

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    async createBrowser(account: Account): Promise<BrowserCreationResult> {
        let browser: PatchrightBrowser

        try {
            const proxyConfig = account.proxy.url
                ? {
                      server: this.formatProxyServer(account.proxy),
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
                'Launching Patchright Chromium (Edge Spoofing enabled)...'
            )

            // Always use Patchright's patched binary for stealth
            // We use 'edge' fingerprint style to get the 20 bonus points even on Chromium engine
            browser = await chromium.launch({
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

            // Use native Patchright context with fingerprint parameters
            // Patchright manages stealth at the binary level, no need for fingerprint-injector
            const context = await browser.newContext({
                userAgent: fingerprint.fingerprint.navigator.userAgent,
                viewport: {
                    width: fingerprint.fingerprint.screen.width,
                    height: fingerprint.fingerprint.screen.height
                },
                locale: account.langCode || 'en-US',
                timezoneId: (fingerprint.fingerprint.navigator as any).extra?.timezone || 'UTC'
            })

            await context.addInitScript(() => {
                // Disable WebAuthn which often triggers dialogs
                Object.defineProperty(navigator, 'credentials', {
                    value: {
                        create: () => Promise.reject(new Error('WebAuthn disabled')),
                        get: () => Promise.reject(new Error('WebAuthn disabled'))
                    }
                })
                // Ensure navigator.webdriver is false (though Patchright does this too)
                Object.defineProperty(navigator, 'webdriver', { get: () => false })
            })

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

            return { context: context as unknown as BrowserContext, fingerprint }
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

    async generateFingerprint(isMobile: boolean) {
        // Force edge fingerprint style to ensure bonus points
        const fingerprintBrowser = 'edge'

        const fingerPrintData = new FingerprintGenerator().getFingerprint({
            devices: isMobile ? ['mobile'] : ['desktop'],
            operatingSystems: isMobile ? ['android', 'ios'] : ['windows', 'linux'],
            browsers: [{ name: fingerprintBrowser }]
        })

        const userAgentManager = new UserAgentManager(this.bot)
        const updatedFingerPrintData = await userAgentManager.updateFingerprintUserAgent(fingerPrintData, isMobile)

        return updatedFingerPrintData
    }
}

export default Browser
