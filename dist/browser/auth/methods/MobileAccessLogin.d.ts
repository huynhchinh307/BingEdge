import type { Page } from 'patchright';
import type { MicrosoftRewardsBot } from '../../../index';
export declare class MobileAccessLogin {
    private bot;
    private page;
    private clientId;
    private authUrl;
    private redirectUrl;
    private tokenUrl;
    private scope;
    private maxTimeout;
    constructor(bot: MicrosoftRewardsBot, page: Page);
    get(email: string): Promise<string>;
}
//# sourceMappingURL=MobileAccessLogin.d.ts.map