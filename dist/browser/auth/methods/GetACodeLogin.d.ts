import type { Page } from 'patchright';
import type { MicrosoftRewardsBot } from '../../../index';
export declare class CodeLogin {
    private bot;
    private readonly textInputSelector;
    private readonly secondairyInputSelector;
    private readonly maxManualSeconds;
    private readonly maxManualAttempts;
    constructor(bot: MicrosoftRewardsBot);
    private fillCode;
    handle(page: Page): Promise<void>;
}
//# sourceMappingURL=GetACodeLogin.d.ts.map