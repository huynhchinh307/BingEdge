import type { Page } from 'playwright-chromium';
import type { DashboardData } from '../../../interface/DashboardData';
import { Workers } from '../../Workers';
export declare class Search extends Workers {
    private bingHome;
    private searchPageURL;
    private searchCount;
    doSearch(data: DashboardData, page: Page, isMobile: boolean): Promise<number>;
    private bingSearch;
    private randomScroll;
    private clickRandomLink;
}
//# sourceMappingURL=Search.d.ts.map