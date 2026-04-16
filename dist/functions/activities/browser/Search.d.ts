import type { Page } from 'patchright';
import type { DashboardData } from '../../../interface/DashboardData';
import { Workers } from '../../Workers';
export declare class Search extends Workers {
    private bingHome;
    private searchPageURL;
    private searchCount;
    doSearch(data: DashboardData, page: Page, isMobile: boolean): Promise<number>;
    /**
     * Simulates human-like typing with variable delays, hesitation pauses, and
     * occasional typos (wrong adjacent key → notice → Backspace → retype correctly).
     */
    private humanType;
    private bingSearch;
    private randomScroll;
    private clickRandomLink;
}
//# sourceMappingURL=Search.d.ts.map