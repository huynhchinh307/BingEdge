import type { Page } from 'patchright';
import type { MicrosoftRewardsBot } from '../../../index';
export declare class AccountRegistration {
    private bot;
    private selectors;
    constructor(bot: MicrosoftRewardsBot);
    fillEmail(page: Page, email: string): Promise<boolean>;
    fillPassword(page: Page, password: string): Promise<boolean>;
    fillName(page: Page, firstName: string, lastName: string): Promise<boolean>;
    fillBirthDate(page: Page, day: string, month: string, year: string): Promise<boolean>;
    enterOtp(page: Page, otp: string): Promise<boolean>;
}
//# sourceMappingURL=AccountRegistration.d.ts.map