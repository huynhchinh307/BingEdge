import type { Page } from 'patchright';
import type { BasePromotion } from '../../../interface/DashboardData';
import { Workers } from '../../Workers';
export declare class Quiz extends Workers {
    private cookieHeader;
    private fingerprintHeader;
    private oldBalance;
    doQuiz(promotion: BasePromotion, page?: Page): Promise<void>;
    private browserVisit;
}
//# sourceMappingURL=Quiz.d.ts.map