export class EmailLogin {
    bot;
    submitButton = 'button[type="submit"]';
    constructor(bot) {
        this.bot = bot;
    }
    async enterEmail(page, email) {
        try {
            const emailInputSelector = 'input[type="email"]';
            this.bot.logger.debug(this.bot.isMobile, 'LOGIN-ENTER-EMAIL', 'Waiting for email field...');
            const emailField = await page
                .waitForSelector(emailInputSelector, { state: 'visible', timeout: 5000 })
                .catch(() => { });
            if (!emailField) {
                this.bot.logger.warn(this.bot.isMobile, 'LOGIN-ENTER-EMAIL', 'Email field not found (timeout 5s)');
                return 'error';
            }
            this.bot.logger.debug(this.bot.isMobile, 'LOGIN-ENTER-EMAIL', 'Email field found');
            await this.bot.utils.wait(1000);
            const prefilledEmail = await page
                .waitForSelector('#userDisplayName', { state: 'visible', timeout: 2000 })
                .catch(() => { });
            if (!prefilledEmail) {
                this.bot.logger.debug(this.bot.isMobile, 'LOGIN-ENTER-EMAIL', `Entering email: ${email}`);
                await page.fill(emailInputSelector, '').catch(() => { });
                await this.bot.utils.wait(500);
                await page.fill(emailInputSelector, email).catch((e) => {
                    this.bot.logger.error(this.bot.isMobile, 'LOGIN-ENTER-EMAIL', `Failed to fill email: ${e}`);
                });
                await this.bot.utils.wait(1000);
            }
            else {
                this.bot.logger.info(this.bot.isMobile, 'LOGIN-ENTER-EMAIL', 'Email prefilled, skipping entry');
            }
            await page.waitForSelector(this.submitButton, { state: 'visible', timeout: 3000 }).catch(() => { });
            await this.bot.browser.utils.ghostClick(page, this.submitButton);
            this.bot.logger.info(this.bot.isMobile, 'LOGIN-ENTER-EMAIL', 'Email submitted');
            return 'ok';
        }
        catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'LOGIN-ENTER-EMAIL', `An error occurred: ${error instanceof Error ? error.message : String(error)}`);
            return 'error';
        }
    }
    async enterPassword(page, password) {
        try {
            const passwordInputSelector = 'input[type="password"]';
            this.bot.logger.debug(this.bot.isMobile, 'LOGIN-ENTER-PASSWORD', 'Waiting for password field...');
            const passwordField = await page
                .waitForSelector(passwordInputSelector, { state: 'visible', timeout: 5000 })
                .catch(() => { });
            if (!passwordField) {
                this.bot.logger.warn(this.bot.isMobile, 'LOGIN-ENTER-PASSWORD', 'Password field not found (timeout 5s)');
                // Try to log page content for debugging
                const html = await page.content().catch(() => '');
                this.bot.logger.debug(this.bot.isMobile, 'LOGIN-ENTER-PASSWORD', `Page HTML snippet: ${html.substring(0, 500)}`);
                return 'error';
            }
            this.bot.logger.debug(this.bot.isMobile, 'LOGIN-ENTER-PASSWORD', 'Password field found, clearing and entering password');
            await this.bot.utils.wait(1000);
            await page.fill(passwordInputSelector, '').catch(() => { });
            await this.bot.utils.wait(500);
            await page.fill(passwordInputSelector, password).catch((e) => {
                this.bot.logger.error(this.bot.isMobile, 'LOGIN-ENTER-PASSWORD', `Failed to fill password: ${e}`);
            });
            await this.bot.utils.wait(1000);
            this.bot.logger.debug(this.bot.isMobile, 'LOGIN-ENTER-PASSWORD', 'Password entered, looking for submit button');
            const submitButton = await page
                .waitForSelector(this.submitButton, { state: 'visible', timeout: 2000 })
                .catch(() => null);
            if (submitButton) {
                await this.bot.browser.utils.ghostClick(page, this.submitButton);
                this.bot.logger.info(this.bot.isMobile, 'LOGIN-ENTER-PASSWORD', 'Password submitted');
            }
            return 'ok';
        }
        catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'LOGIN-ENTER-PASSWORD', `An error occurred: ${error instanceof Error ? error.message : String(error)}`);
            return 'error';
        }
    }
}
//# sourceMappingURL=EmailLogin.js.map