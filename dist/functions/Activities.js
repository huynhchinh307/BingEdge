// App
import { DailyCheckIn } from './activities/app/DailyCheckIn.js';
import { ReadToEarn } from './activities/app/ReadToEarn.js';
import { AppReward } from './activities/app/AppReward.js';
// API
import { UrlReward } from './activities/api/UrlReward.js';
import { Quiz } from './activities/api/Quiz.js';
import { FindClippy } from './activities/api/FindClippy.js';
import { DoubleSearchPoints } from './activities/api/DoubleSearchPoints.js';
// Browser
import { SearchOnBing } from './activities/browser/SearchOnBing.js';
import { Search } from './activities/browser/Search.js';
export default class Activities {
    bot;
    constructor(bot) {
        this.bot = bot;
    }
    // Browser Activities
    doSearch = async (data, page, isMobile) => {
        const search = new Search(this.bot);
        return await search.doSearch(data, page, isMobile);
    };
    doSearchOnBing = async (promotion, page) => {
        const searchOnBing = new SearchOnBing(this.bot);
        await searchOnBing.doSearchOnBing(promotion, page);
    };
    /*
    doABC = async (page: Page): Promise<void> => {
        const abc = new ABC(this.bot)
        await abc.doABC(page)
    }
    */
    /*
    doPoll = async (page: Page): Promise<void> => {
        const poll = new Poll(this.bot)
        await poll.doPoll(page)
    }
    */
    /*
    doThisOrThat = async (page: Page): Promise<void> => {
        const thisOrThat = new ThisOrThat(this.bot)
        await thisOrThat.doThisOrThat(page)
    }
    */
    // API Activities
    doUrlReward = async (promotion, page) => {
        const urlReward = new UrlReward(this.bot);
        await urlReward.doUrlReward(promotion, page);
    };
    doQuiz = async (promotion, page) => {
        const quiz = new Quiz(this.bot);
        await quiz.doQuiz(promotion, page);
    };
    doFindClippy = async (promotion) => {
        const findClippy = new FindClippy(this.bot);
        await findClippy.doFindClippy(promotion);
    };
    doDoubleSearchPoints = async (promotion) => {
        const doubleSearchPoints = new DoubleSearchPoints(this.bot);
        await doubleSearchPoints.doDoubleSearchPoints(promotion);
    };
    // App Activities
    doAppReward = async (promotion) => {
        const urlReward = new AppReward(this.bot);
        await urlReward.doAppReward(promotion);
    };
    doReadToEarn = async () => {
        const readToEarn = new ReadToEarn(this.bot);
        await readToEarn.doReadToEarn();
    };
    doDailyCheckIn = async () => {
        const dailyCheckIn = new DailyCheckIn(this.bot);
        await dailyCheckIn.doDailyCheckIn();
    };
}
//# sourceMappingURL=Activities.js.map