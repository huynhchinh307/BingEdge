import patchright from 'patchright';
import { newInjectedContext } from 'fingerprint-injector';
import { FingerprintGenerator } from 'fingerprint-generator';
import fs from 'fs';
import path from 'path';
import { loadSessionData, saveFingerprintData } from '../util/Load.js';
import { UserAgentManager } from './UserAgent.js';
class Browser {
    bot;
    static BROWSER_ARGS = [
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
    ];
    constructor(bot) {
        this.bot = bot;
    }
    async createBrowser(account) {
        let browser;
        try {
            let bypassString = undefined;
            const bypassFilePath = path.join(process.cwd(), 'bypass.txt');
            if (fs.existsSync(bypassFilePath)) {
                try {
                    const bypassContent = fs.readFileSync(bypassFilePath, 'utf8').trim();
                    if (bypassContent) {
                        bypassString = bypassContent;
                    }
                }
                catch (e) {
                    this.bot.logger.warn(this.bot.isMobile, 'BROWSER', `Failed to read bypass.txt: ${e.message}`);
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
                : undefined;
            this.bot.logger.info(this.bot.isMobile, 'BROWSER', `Launching stealth browser (Patchright)`);
            browser = await patchright.chromium.launch({
                headless: this.bot.config.headless,
                ...(proxyConfig && { proxy: proxyConfig }),
                args: [...Browser.BROWSER_ARGS]
            });
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.logger.error(this.bot.isMobile, 'BROWSER', `Launch failed: ${errorMessage}`);
            throw error;
        }
        try {
            const sessionData = await loadSessionData(this.bot.config.sessionPath, account.email, account.saveFingerprint, this.bot.isMobile);
            const fingerprint = sessionData.fingerprint ?? (await this.generateFingerprint(this.bot.isMobile));
            const locale = account.geoLocale === 'auto' ? 'en-US' : `${account.geoLocale.toLowerCase()}-${account.geoLocale.toUpperCase()}`;
            const context = await newInjectedContext(browser, {
                fingerprint,
                newContextOptions: {
                    locale,
                    bypassCSP: true,
                    ignoreHTTPSErrors: true,
                    permissions: []
                }
            });
            await context.addInitScript(() => {
                Object.defineProperty(navigator, 'credentials', {
                    value: {
                        create: () => Promise.reject(new Error('WebAuthn disabled')),
                        get: () => Promise.reject(new Error('WebAuthn disabled'))
                    }
                });
            });
            context.setDefaultTimeout(this.bot.utils.stringToNumber(this.bot.config?.globalTimeout ?? 30000));
            await context.addCookies(sessionData.cookies);
            if ((account.saveFingerprint.mobile && this.bot.isMobile) ||
                (account.saveFingerprint.desktop && !this.bot.isMobile)) {
                await saveFingerprintData(this.bot.config.sessionPath, account.email, this.bot.isMobile, fingerprint);
            }
            this.bot.logger.info(this.bot.isMobile, 'BROWSER', `Created browser with User-Agent: "${fingerprint.fingerprint.navigator.userAgent}"`);
            this.bot.logger.debug(this.bot.isMobile, 'BROWSER-FINGERPRINT', JSON.stringify(fingerprint));
            return { context: context, fingerprint };
        }
        catch (error) {
            await browser.close().catch(() => { });
            throw error;
        }
    }
    formatProxyServer(proxy) {
        try {
            const urlObj = new URL(proxy.url);
            const protocol = urlObj.protocol.replace(':', '');
            return `${protocol}://${urlObj.hostname}:${proxy.port}`;
        }
        catch {
            return `${proxy.url}:${proxy.port}`;
        }
    }
    async generateFingerprint(isMobile) {
        const browserType = this.bot.config.browserType ?? 'chromium';
        const fingerprintBrowser = browserType === 'edge' ? 'edge' : 'chrome';
        const fingerPrintData = new FingerprintGenerator().getFingerprint({
            devices: isMobile ? ['mobile'] : ['desktop'],
            operatingSystems: isMobile ? ['android', 'ios'] : ['windows', 'macos', 'linux'],
            browsers: [fingerprintBrowser]
        });
        const userAgentManager = new UserAgentManager(this.bot);
        const updatedFingerPrintData = await userAgentManager.updateFingerprintUserAgent(fingerPrintData, isMobile);
        return updatedFingerPrintData;
    }
}
export default Browser;
//# sourceMappingURL=Browser.js.map