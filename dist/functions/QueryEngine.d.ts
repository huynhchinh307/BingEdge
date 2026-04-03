import type { MicrosoftRewardsBot } from '../index';
import { QueryEngine } from '../interface/Config';
export declare class QueryCore {
    private bot;
    constructor(bot: MicrosoftRewardsBot);
    queryManager(options?: {
        shuffle?: boolean;
        sourceOrder?: QueryEngine[];
        related?: boolean;
        langCode?: string;
        geoLocale?: string;
    }): Promise<string[]>;
    private buildRelatedClusters;
    private normalizeAndDedupe;
    getGoogleTrends(geoLocale: string): Promise<string[]>;
    private extractJsonFromResponse;
    getBingSuggestions(query?: string, langCode?: string): Promise<string[]>;
    getBingRelatedTerms(query: string): Promise<string[]>;
    getBingTrendingTopics(langCode?: string): Promise<string[]>;
    getWikipediaTrending(langCode?: string): Promise<string[]>;
    getRedditTopics(subreddit?: string): Promise<string[]>;
    getLocalQueryList(): string[];
}
//# sourceMappingURL=QueryEngine.d.ts.map