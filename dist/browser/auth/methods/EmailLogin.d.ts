import type { Page } from 'patchright';
import type { MicrosoftRewardsBot } from '../../../index';
export declare class EmailLogin {
    private bot;
    private submitButton;
    constructor(bot: MicrosoftRewardsBot);
    enterEmail(page: Page, email: string): Promise<'ok' | 'error'>;
    enterPassword(page: Page, password: string): Promise<'ok' | 'needs-2fa' | 'error'>;
}
//# sourceMappingURL=EmailLogin.d.ts.map