import type { Page } from 'patchright';
import type { MicrosoftRewardsBot } from '../index';
import type { DashboardData } from '../interface/DashboardData';
import type { AppDashboardData } from '../interface/AppDashBoardData';
export declare class Workers {
    bot: MicrosoftRewardsBot;
    constructor(bot: MicrosoftRewardsBot);
    doDailySet(data: DashboardData, page: Page): Promise<void>;
    doMorePromotions(data: DashboardData, page: Page): Promise<void>;
    doAppPromotions(data: AppDashboardData): Promise<void>;
    doSpecialPromotions(data: DashboardData): Promise<void>;
    private solveActivities;
    private revealDailySetElements;
    private solveActivityViaUI;
    private isActivityUncompleted;
    private isActivityCompleted;
}
//# sourceMappingURL=Workers.d.ts.map