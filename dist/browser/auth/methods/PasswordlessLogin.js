"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PasswordlessLogin = void 0;
class PasswordlessLogin {
    constructor(bot) {
        this.bot = bot;
        this.maxAttempts = 60;
        this.numberDisplaySelector = 'div[data-testid="displaySign"]';
        this.approvalPath = '/ppsecure/post.srf';
    }
    async getDisplayedNumber(page) {
        try {
            const numberElement = await page
                .waitForSelector(this.numberDisplaySelector, {
                timeout: 5000
            })
                .catch(() => null);
            if (numberElement) {
                const number = await numberElement.textContent();
                return number?.trim() || null;
            }
        }
        catch (error) {
            this.bot.logger.warn(this.bot.isMobile, 'LOGIN-PASSWORDLESS', 'Could not retrieve displayed number');
        }
        return null;
    }
    async waitForApproval(page) {
        try {
            this.bot.logger.info(this.bot.isMobile, 'LOGIN-PASSWORDLESS', `Waiting for approval... (timeout after ${this.maxAttempts} seconds)`);
            for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
                const currentUrl = new URL(page.url());
                if (currentUrl.pathname === this.approvalPath) {
                    this.bot.logger.info(this.bot.isMobile, 'LOGIN-PASSWORDLESS', 'Approval detected');
                    return true;
                }
                // Every 5 seconds to show it's still waiting
                if (attempt % 5 === 0) {
                    this.bot.logger.info(this.bot.isMobile, 'LOGIN-PASSWORDLESS', `Still waiting... (${attempt}/${this.maxAttempts} seconds elapsed)`);
                }
                await this.bot.utils.wait(1000);
            }
            this.bot.logger.warn(this.bot.isMobile, 'LOGIN-PASSWORDLESS', `Approval timeout after ${this.maxAttempts} seconds!`);
            return false;
        }
        catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'LOGIN-PASSWORDLESS', `Approval failed, an error occurred: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    async handle(page) {
        try {
            this.bot.logger.info(this.bot.isMobile, 'LOGIN-PASSWORDLESS', 'Passwordless authentication requested');
            const displayedNumber = await this.getDisplayedNumber(page);
            if (displayedNumber) {
                this.bot.logger.info(this.bot.isMobile, 'LOGIN-PASSWORDLESS', `Please approve login and select number: ${displayedNumber}`);
            }
            else {
                this.bot.logger.info(this.bot.isMobile, 'LOGIN-PASSWORDLESS', 'Please approve login on your authenticator app');
            }
            const approved = await this.waitForApproval(page);
            if (approved) {
                this.bot.logger.info(this.bot.isMobile, 'LOGIN-PASSWORDLESS', 'Login approved successfully');
                await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { });
            }
            else {
                this.bot.logger.error(this.bot.isMobile, 'LOGIN-PASSWORDLESS', 'Login approval failed or timed out');
                throw new Error('Passwordless authentication timeout');
            }
        }
        catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'LOGIN-PASSWORDLESS', `An error occurred: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
}
exports.PasswordlessLogin = PasswordlessLogin;
//# sourceMappingURL=PasswordlessLogin.js.map