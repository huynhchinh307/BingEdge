export class AccountRegistration {
    bot;
    selectors = {
        createOne: '#signup',
        emailInput: 'input[type="email"]',
        nextButton: 'input[type="submit"][value="Next"], input[type="submit"]#nextbutton',
        passwordInput: 'input[type="password"]',
        firstNameInput: 'input[name="FirstName"]',
        lastNameInput: 'input[name="LastName"]',
        birthDaySelect: 'select[name="BirthDay"]',
        birthMonthSelect: 'select[name="BirthMonth"]',
        birthYearInput: 'input[name="BirthYear"]',
        otpInput: 'input[name="VerificationCode"]',
        finishButton: 'input[type="submit"][value="Finish"], input[type="submit"]'
    };
    constructor(bot) {
        this.bot = bot;
    }
    async fillEmail(page, email) {
        try {
            this.bot.logger.info(this.bot.isMobile, 'REGISTRATION', `Filling email: ${email}`);
            await page.fill(this.selectors.emailInput, email);
            await this.bot.utils.wait(1000);
            await page.click(this.selectors.nextButton);
            await page.waitForLoadState('networkidle');
            return true;
        }
        catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'REGISTRATION', `Error filling email: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }
    async fillPassword(page, password) {
        try {
            this.bot.logger.info(this.bot.isMobile, 'REGISTRATION', 'Filling password');
            await page.waitForSelector(this.selectors.passwordInput, { state: 'visible' });
            await page.fill(this.selectors.passwordInput, password);
            await this.bot.utils.wait(1000);
            await page.click(this.selectors.nextButton);
            await page.waitForLoadState('networkidle');
            return true;
        }
        catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'REGISTRATION', `Error filling password: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }
    async fillName(page, firstName, lastName) {
        try {
            this.bot.logger.info(this.bot.isMobile, 'REGISTRATION', `Filling name: ${firstName} ${lastName}`);
            await page.waitForSelector(this.selectors.firstNameInput, { state: 'visible' });
            await page.fill(this.selectors.firstNameInput, firstName);
            await page.fill(this.selectors.lastNameInput, lastName);
            await this.bot.utils.wait(1000);
            await page.click(this.selectors.nextButton);
            await page.waitForLoadState('networkidle');
            return true;
        }
        catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'REGISTRATION', `Error filling name: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }
    async fillBirthDate(page, day, month, year) {
        try {
            this.bot.logger.info(this.bot.isMobile, 'REGISTRATION', `Filling birth date: ${day}/${month}/${year}`);
            await page.waitForSelector(this.selectors.birthDaySelect, { state: 'visible' });
            await page.selectOption(this.selectors.birthDaySelect, day);
            await page.selectOption(this.selectors.birthMonthSelect, month);
            await page.fill(this.selectors.birthYearInput, year);
            await this.bot.utils.wait(1000);
            await page.click(this.selectors.nextButton);
            await page.waitForLoadState('networkidle');
            return true;
        }
        catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'REGISTRATION', `Error filling birth date: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }
    async enterOtp(page, otp) {
        try {
            this.bot.logger.info(this.bot.isMobile, 'REGISTRATION', `Entering OTP: ${otp}`);
            await page.waitForSelector(this.selectors.otpInput, { state: 'visible' });
            await page.fill(this.selectors.otpInput, otp);
            await this.bot.utils.wait(1000);
            await page.click(this.selectors.nextButton);
            await page.waitForLoadState('networkidle');
            return true;
        }
        catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'REGISTRATION', `Error entering OTP: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }
}
//# sourceMappingURL=AccountRegistration.js.map