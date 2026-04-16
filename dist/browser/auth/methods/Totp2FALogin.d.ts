import type { Page } from 'patchright';
import type { MicrosoftRewardsBot } from '../../../index';
export declare class TotpLogin {
    private bot;
    private readonly textInputSelector;
    private readonly secondairyInputSelector;
    private readonly submitButtonSelector;
    private readonly maxManualSeconds;
    private readonly maxManualAttempts;
    constructor(bot: MicrosoftRewardsBot);
    private generateTotpCode;
    private fillCode;
    handle(page: Page, totpSecret?: string): Promise<void>;
}
//# sourceMappingURL=Totp2FALogin.d.ts.map