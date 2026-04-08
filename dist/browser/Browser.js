"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const playwright_chromium_1 = require("playwright-chromium");
const fingerprint_generator_1 = require("fingerprint-generator");
const fingerprint_injector_1 = require("fingerprint-injector");
const Load_1 = require("../util/Load");
const UserAgent_1 = require("./UserAgent");
class Browser {
    constructor(bot) {
        this.bot = bot;
    }
    async createBrowser(account) {
        let browser;
        const browserType = this.bot.config.browserType ?? 'chromium';
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
                : undefined;
            this.bot.logger.info(this.bot.isMobile, 'BROWSER', `Launching Chromium (website fingerprint: ${browserType.toUpperCase()})`);
            browser = await playwright_chromium_1.chromium.launch({
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
            const sessionData = await (0, Load_1.loadSessionData)(this.bot.config.sessionPath, account.email, account.saveFingerprint, this.bot.isMobile);
            const fingerprint = sessionData.fingerprint ?? (await this.generateFingerprint(this.bot.isMobile));
            // Use newInjectedContext for better consistency
            const context = await (0, fingerprint_injector_1.newInjectedContext)(browser, { fingerprint });
            await context.addInitScript(() => {
                // Disable WebAuthn which often triggers dialogs
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
                await (0, Load_1.saveFingerprintData)(this.bot.config.sessionPath, account.email, this.bot.isMobile, fingerprint);
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
        const fingerPrintData = new fingerprint_generator_1.FingerprintGenerator().getFingerprint({
            devices: isMobile ? ['mobile'] : ['desktop'],
            operatingSystems: isMobile ? ['android', 'ios'] : ['windows', 'linux'],
            browsers: [{ name: fingerprintBrowser }]
        });
        const userAgentManager = new UserAgent_1.UserAgentManager(this.bot);
        const updatedFingerPrintData = await userAgentManager.updateFingerprintUserAgent(fingerPrintData, isMobile);
        return updatedFingerPrintData;
    }
}
Browser.BROWSER_ARGS = [
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
];
exports.default = Browser;
//# sourceMappingURL=Browser.js.map