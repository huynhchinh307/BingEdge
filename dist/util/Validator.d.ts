import { z } from 'zod';
import { Config } from '../interface/Config';
import { Account } from '../interface/Account';
export declare const ConfigSchema: z.ZodDefault<z.ZodOptional<z.ZodObject<{
    baseURL: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    sessionPath: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    headless: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    browserType: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        chromium: "chromium";
        edge: "edge";
    }>>>;
    runOnZeroPoints: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    clusters: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    errorDiagnostics: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    workers: z.ZodDefault<z.ZodOptional<z.ZodObject<{
        doDailySet: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        doSpecialPromotions: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        doMorePromotions: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        doPunchCards: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        doAppPromotions: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        doDesktopSearch: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        doMobileSearch: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        doDailyCheckIn: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        doReadToEarn: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    }, z.core.$strip>>>;
    searchOnBingLocalQueries: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    globalTimeout: z.ZodDefault<z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>>;
    searchSettings: z.ZodDefault<z.ZodOptional<z.ZodObject<{
        scrollRandomResults: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        clickRandomResults: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        parallelSearching: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        queryEngines: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodEnum<{
            google: "google";
            wikipedia: "wikipedia";
            reddit: "reddit";
            local: "local";
            gemini: "gemini";
        }>>>>;
        searchResultVisitTime: z.ZodDefault<z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>>;
        searchDelay: z.ZodDefault<z.ZodOptional<z.ZodObject<{
            min: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
            max: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
        }, z.core.$strip>>>;
        readDelay: z.ZodDefault<z.ZodOptional<z.ZodObject<{
            min: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
            max: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
        }, z.core.$strip>>>;
    }, z.core.$strip>>>;
    debugLogs: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    proxy: z.ZodDefault<z.ZodOptional<z.ZodObject<{
        enable: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        url: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        port: z.ZodDefault<z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>>;
        username: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        password: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        queryEngine: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    }, z.core.$strip>>>;
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
    geminiApiKey: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    geminiModel: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    geminiEndpoint: z.ZodDefault<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>>>;
export declare const AccountSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    totpSecret: z.ZodOptional<z.ZodString>;
    recoveryEmail: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    geoLocale: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    langCode: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    proxy: z.ZodDefault<z.ZodOptional<z.ZodObject<{
        proxyAxios: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        url: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        port: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
        password: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        username: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    }, z.core.$strip>>>;
    saveFingerprint: z.ZodDefault<z.ZodOptional<z.ZodObject<{
        mobile: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        desktop: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    }, z.core.$strip>>>;
    points: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    initialPoints: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    collectedPoints: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    duration: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    rank: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    lastUpdate: z.ZodDefault<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export declare function validateConfig(data: unknown): Config;
export declare function validateAccounts(data: unknown): Account[];
export declare function checkNodeVersion(): void;
//# sourceMappingURL=Validator.d.ts.map