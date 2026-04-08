import type { Page } from 'playwright-chromium';
import type { BasePromotion } from '../../../interface/DashboardData';
import { Workers } from '../../Workers';
export declare class UrlReward extends Workers {
    private cookieHeader;
    private fingerprintHeader;
    private gainedPoints;
    private oldBalance;
    doUrlReward(promotion: BasePromotion, page?: Page): Promise<void>;
    private browserVisit;
}
//# sourceMappingURL=UrlReward.d.ts.map