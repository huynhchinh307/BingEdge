import { z } from 'zod';
import { Config } from '../interface/Config';
import { Account } from '../interface/Account';
export declare const ConfigSchema: z.ZodObject<{
    baseURL: z.ZodString;
    sessionPath: z.ZodString;
    headless: z.ZodBoolean;
    browserType: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        chromium: "chromium";
        edge: "edge";
    }>>>;
    runOnZeroPoints: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    clusters: z.ZodNumber;
    errorDiagnostics: z.ZodDefault<z.ZodBoolean>;
    workers: z.ZodDefault<z.ZodObject<{
        doDailySet: z.ZodDefault<z.ZodBoolean>;
        doSpecialPromotions: z.ZodDefault<z.ZodBoolean>;
        doMorePromotions: z.ZodDefault<z.ZodBoolean>;
        doPunchCards: z.ZodDefault<z.ZodBoolean>;
        doAppPromotions: z.ZodDefault<z.ZodBoolean>;
        doDesktopSearch: z.ZodDefault<z.ZodBoolean>;
        doMobileSearch: z.ZodDefault<z.ZodBoolean>;
        doDailyCheckIn: z.ZodDefault<z.ZodBoolean>;
        doReadToEarn: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    searchOnBingLocalQueries: z.ZodDefault<z.ZodBoolean>;
    globalTimeout: z.ZodDefault<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>;
    searchSettings: z.ZodDefault<z.ZodObject<{
        scrollRandomResults: z.ZodDefault<z.ZodBoolean>;
        clickRandomResults: z.ZodDefault<z.ZodBoolean>;
        parallelSearching: z.ZodDefault<z.ZodBoolean>;
        queryEngines: z.ZodDefault<z.ZodArray<z.ZodEnum<{
            google: "google";
            wikipedia: "wikipedia";
            reddit: "reddit";
            local: "local";
            gemini: "gemini";
        }>>>;
        searchResultVisitTime: z.ZodDefault<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>;
        searchDelay: z.ZodDefault<z.ZodObject<{
            min: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
            max: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
        }, z.core.$strip>>;
        readDelay: z.ZodDefault<z.ZodObject<{
            min: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
            max: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    debugLogs: z.ZodDefault<z.ZodBoolean>;
    proxy: z.ZodDefault<z.ZodObject<{
        queryEngine: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    consoleLogFilter: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        mode: z.ZodDefault<z.ZodEnum<{
            whitelist: "whitelist";
            blacklist: "blacklist";
        }>>;
        levels: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodEnum<{
            debug: "debug";
            info: "info";
            warn: "warn";
            error: "error";
        }>>>>;
        keywords: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString>>>;
        regexPatterns: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString>>>;
    }, z.core.$strip>>;
    webhook: z.ZodDefault<z.ZodObject<{
        discord: z.ZodDefault<z.ZodOptional<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            url: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>>>;
        ntfy: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
            url: z.ZodDefault<z.ZodString>;
            topic: z.ZodOptional<z.ZodString>;
            token: z.ZodOptional<z.ZodString>;
            title: z.ZodOptional<z.ZodString>;
            tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
            priority: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>, z.ZodLiteral<4>, z.ZodLiteral<5>]>>;
        }, z.core.$strip>>;
        webhookLogFilter: z.ZodDefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            mode: z.ZodDefault<z.ZodEnum<{
                whitelist: "whitelist";
                blacklist: "blacklist";
            }>>;
            levels: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodEnum<{
                debug: "debug";
                info: "info";
                warn: "warn";
                error: "error";
            }>>>>;
            keywords: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString>>>;
            regexPatterns: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString>>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    geminiApiKey: z.ZodOptional<z.ZodString>;
    geminiModel: z.ZodOptional<z.ZodString>;
    geminiEndpoint: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const AccountSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
    totpSecret: z.ZodOptional<z.ZodString>;
    recoveryEmail: z.ZodString;
    geoLocale: z.ZodString;
    langCode: z.ZodString;
    proxy: z.ZodObject<{
        proxyAxios: z.ZodBoolean;
        url: z.ZodString;
        port: z.ZodNumber;
        password: z.ZodString;
        username: z.ZodString;
    }, z.core.$strip>;
    saveFingerprint: z.ZodObject<{
        mobile: z.ZodBoolean;
        desktop: z.ZodBoolean;
    }, z.core.$strip>;
    points: z.ZodOptional<z.ZodNumber>;
    lastUpdate: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare function validateConfig(data: unknown): Config;
export declare function validateAccounts(data: unknown): Account[];
export declare function checkNodeVersion(): void;
//# sourceMappingURL=Validator.d.ts.map