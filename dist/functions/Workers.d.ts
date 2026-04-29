import type { Page } from 'patchright';
import type { MicrosoftRewardsBot } from '../index';
import type { DashboardData } from '../interface/DashboardData';
import type { AppDashboardData } from '../interface/AppDashBoardData';
export declare class Workers {
    bot: MicrosoftRewardsBot;
    constructor(bot: MicrosoftRewardsBot);
    doDailySet(data: DashboardData, page: Page): Promise<void>;
    doMorePromotions(page: Page): Promise<void>;
    doAppPromotions(data: AppDashboardData): Promise<void>;
    doSpecialPromotions(data: DashboardData): Promise<void>;
    private solveActivities;
    private revealDailySetElements;
    /**
     * Đóng tab một cách an toàn — thử nhiều cách nếu close() thất bại
     */
    private forceClosePage;
    /**
     * Dọn dẹp tất cả tab thừa — giữ lại tab dashboard chính
     */
    private cleanupOrphanTabs;
    private solveActivityViaUI;
    private isActivityUncompleted;
    private isActivityCompleted;
}
//# sourceMappingURL=Workers.d.ts.map