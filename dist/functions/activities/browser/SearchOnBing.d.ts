import type { Page } from 'patchright';
import { Workers } from '../../Workers';
import type { BasePromotion } from '../../../interface/DashboardData';
export declare class SearchOnBing extends Workers {
    private bingHome;
    private cookieHeader;
    private fingerprintHeader;
    private gainedPoints;
    private success;
    private oldBalance;
    doSearchOnBing(promotion: BasePromotion, page: Page): Promise<void>;
    /**
     * Simulates human-like typing with variable delays, hesitation pauses, and
     * occasional typos (wrong adjacent key → notice → Backspace → retype correctly).
     */
    private humanType;
    private searchBing;
    private activateSearchTask;
    private getSearchQueries;
}
//# sourceMappingURL=SearchOnBing.d.ts.map