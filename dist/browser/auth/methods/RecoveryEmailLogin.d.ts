import type { Page } from 'patchright';
import type { MicrosoftRewardsBot } from '../../../index';
export declare class RecoveryLogin {
    private bot;
    private readonly textInputSelector;
    private readonly maxManualSeconds;
    private readonly maxManualAttempts;
    constructor(bot: MicrosoftRewardsBot);
    private fillEmail;
    handle(page: Page, recoveryEmail: string): Promise<void>;
}
//# sourceMappingURL=RecoveryEmailLogin.d.ts.map