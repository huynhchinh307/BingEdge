import type { Promotion } from '../../../interface/AppDashBoardData';
import { Workers } from '../../Workers';
export declare class AppReward extends Workers {
    private gainedPoints;
    private oldBalance;
    doAppReward(promotion: Promotion): Promise<void>;
}
//# sourceMappingURL=AppReward.d.ts.map