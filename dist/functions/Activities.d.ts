import type { MicrosoftRewardsBot } from '../index';
import type { Page } from 'patchright';
import type { BasePromotion, DashboardData, FindClippyPromotion, PurplePromotionalItem } from '../interface/DashboardData';
import type { Promotion } from '../interface/AppDashBoardData';
export default class Activities {
    private bot;
    constructor(bot: MicrosoftRewardsBot);
    doSearch: (data: DashboardData, page: Page, isMobile: boolean) => Promise<number>;
    doSearchOnBing: (promotion: BasePromotion, page: Page) => Promise<void>;
    doUrlReward: (promotion: BasePromotion, page?: Page) => Promise<void>;
    doQuiz: (promotion: BasePromotion, page?: Page) => Promise<void>;
    doFindClippy: (promotion: FindClippyPromotion) => Promise<void>;
    doDoubleSearchPoints: (promotion: PurplePromotionalItem) => Promise<void>;
    doAppReward: (promotion: Promotion) => Promise<void>;
    doReadToEarn: () => Promise<void>;
    doDailyCheckIn: () => Promise<void>;
}
//# sourceMappingURL=Activities.d.ts.map