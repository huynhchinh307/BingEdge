import type { Page } from 'playwright-chromium';
import type { MicrosoftRewardsBot } from '../../../index';
export declare class PasswordlessLogin {
    private bot;
    private readonly maxAttempts;
    private readonly numberDisplaySelector;
    private readonly approvalPath;
    constructor(bot: MicrosoftRewardsBot);
    private getDisplayedNumber;
    private waitForApproval;
    handle(page: Page): Promise<void>;
}
//# sourceMappingURL=PasswordlessLogin.d.ts.map