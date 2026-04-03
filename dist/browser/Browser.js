"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const patchright_1 = require("patchright");
const fingerprint_generator_1 = require("fingerprint-generator");
const Load_1 = require("../util/Load");
const UserAgent_1 = require("./UserAgent");
class Browser {
    constructor(bot) {
        this.bot = bot;
    }
    async createBrowser(account) {
        let browser;
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
            this.bot.logger.info(this.bot.isMobile, 'BROWSER', 'Launching Patchright Chromium (Edge Spoofing enabled)...');
            // Always use Patchright's patched binary for stealth
            // We use 'edge' fingerprint style to get the 20 bonus points even on Chromium engine
            browser = await patchright_1.chromium.launch({
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
            // Use native Patchright context with fingerprint parameters
            // Patchright manages stealth at the binary level, no need for fingerprint-injector
            const context = await browser.newContext({
                userAgent: fingerprint.fingerprint.navigator.userAgent,
                viewport: {
                    width: fingerprint.fingerprint.screen.width,
                    height: fingerprint.fingerprint.screen.height
                },
                locale: account.langCode || 'en-US',
                timezoneId: fingerprint.fingerprint.navigator.extra?.timezone || 'UTC'
            });
            await context.addInitScript(() => {
                // Disable WebAuthn which often triggers dialogs
                Object.defineProperty(navigator, 'credentials', {
                    value: {
                        create: () => Promise.reject(new Error('WebAuthn disabled')),
                        get: () => Promise.reject(new Error('WebAuthn disabled'))
                    }
                });
                // Ensure navigator.webdriver is false (though Patchright does this too)
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
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
        // Force edge fingerprint style to ensure bonus points
        const fingerprintBrowser = 'edge';
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