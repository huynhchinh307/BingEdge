import { z } from 'zod';
import semver from 'semver';
import pkg from '../../package.json' with { type: 'json' };
const NumberOrString = z.union([z.number(), z.string()]);
const LogFilterSchema = z.object({
    enabled: z.boolean().default(false),
    mode: z.enum(['whitelist', 'blacklist']).default('blacklist'),
    levels: z.array(z.enum(['debug', 'info', 'warn', 'error'])).optional().default(['error']),
    keywords: z.array(z.string()).optional().default([]),
    regexPatterns: z.array(z.string()).optional().default([])
}).default({
    enabled: false,
    mode: 'blacklist',
    levels: ['error'],
    keywords: [],
    regexPatterns: []
});
const DelaySchema = z.object({
    min: NumberOrString,
    max: NumberOrString
});
const QueryEngineSchema = z.enum(['google', 'wikipedia', 'reddit', 'local', 'gemini']);
// Webhook
const WebhookSchema = z.object({
    discord: z
        .object({
        enabled: z.boolean().default(false),
        url: z.string().default('')
    })
        .optional()
        .default({ enabled: false, url: '' }),
    ntfy: z
        .object({
        enabled: z.boolean().optional().default(false),
        url: z.string().default(''),
        topic: z.string().optional(),
        token: z.string().optional(),
        title: z.string().optional(),
        tags: z.array(z.string()).optional(),
        priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional()
    })
        .optional(),
    webhookLogFilter: LogFilterSchema
}).default({
    discord: { enabled: false, url: '' },
    webhookLogFilter: {
        enabled: false,
        mode: 'blacklist',
        levels: ['error'],
        keywords: [],
        regexPatterns: []
    }
});
// Config
export const ConfigSchema = z.object({
    baseURL: z.string().optional().default('https://rewards.bing.com'),
    sessionPath: z.string().optional().default('sessions'),
    headless: z.boolean().optional().default(false),
    browserType: z.enum(['chromium', 'edge']).optional().default('chromium'),
    runOnZeroPoints: z.boolean().optional().default(false),
    clusters: z.number().int().nonnegative().optional().default(1),
    errorDiagnostics: z.boolean().optional().default(true),
    workers: z.object({
        doDailySet: z.boolean().optional().default(true),
        doSpecialPromotions: z.boolean().optional().default(true),
        doMorePromotions: z.boolean().optional().default(true),
        doPunchCards: z.boolean().optional().default(true),
        doAppPromotions: z.boolean().optional().default(true),
        doDesktopSearch: z.boolean().optional().default(true),
        doMobileSearch: z.boolean().optional().default(true),
        doDailyCheckIn: z.boolean().optional().default(true),
        doReadToEarn: z.boolean().optional().default(true)
    }).optional().default({
        doDailySet: true,
        doSpecialPromotions: true,
        doMorePromotions: true,
        doPunchCards: true,
        doAppPromotions: true,
        doDesktopSearch: true,
        doMobileSearch: true,
        doDailyCheckIn: true,
        doReadToEarn: true
    }),
    searchOnBingLocalQueries: z.boolean().optional().default(false),
    globalTimeout: NumberOrString.optional().default(120000),
    searchSettings: z.object({
        scrollRandomResults: z.boolean().optional().default(true),
        clickRandomResults: z.boolean().optional().default(true),
        parallelSearching: z.boolean().optional().default(false),
        queryEngines: z.array(QueryEngineSchema).optional().default(['google', 'wikipedia', 'reddit', 'local']),
        searchResultVisitTime: NumberOrString.optional().default('5-10s'),
        searchDelay: DelaySchema.optional().default({ min: '2s', max: '5s' }),
        readDelay: DelaySchema.optional().default({ min: '1s', max: '3s' })
    }).optional().default({
        scrollRandomResults: true,
        clickRandomResults: true,
        parallelSearching: false,
        queryEngines: ['google', 'wikipedia', 'reddit', 'local'],
        searchResultVisitTime: '5-10s',
        searchDelay: { min: '2s', max: '5s' },
        readDelay: { min: '1s', max: '3s' }
    }),
    debugLogs: z.boolean().optional().default(false),
    proxy: z.object({
        enable: z.boolean().optional().default(false),
        url: z.string().optional().default(''),
        port: z.union([z.string(), z.number()]).optional().default(''),
        username: z.string().optional().default(''),
        password: z.string().optional().default(''),
        queryEngine: z.boolean().optional().default(false)
    }).optional().default({
        enable: false,
        url: '',
        port: '',
        username: '',
        password: '',
        queryEngine: false
    }),
    consoleLogFilter: LogFilterSchema,
    webhook: WebhookSchema,
    geminiApiKey: z.string().optional().default(''),
    geminiModel: z.string().optional().default('gemini-1.5-flash'),
    geminiEndpoint: z.string().optional().default('https://generativelanguage.googleapis.com')
}).optional().default({
    baseURL: 'https://rewards.bing.com',
    sessionPath: 'sessions',
    headless: false,
    browserType: 'chromium',
    runOnZeroPoints: false,
    clusters: 1,
    errorDiagnostics: true,
    workers: {
        doDailySet: true,
        doSpecialPromotions: true,
        doMorePromotions: true,
        doPunchCards: true,
        doAppPromotions: true,
        doDesktopSearch: true,
        doMobileSearch: true,
        doDailyCheckIn: true,
        doReadToEarn: true
    },
    searchOnBingLocalQueries: false,
    globalTimeout: 120000,
    searchSettings: {
        scrollRandomResults: true,
        clickRandomResults: true,
        parallelSearching: false,
        queryEngines: ['google', 'wikipedia', 'reddit', 'local'],
        searchResultVisitTime: '5-10s',
        searchDelay: { min: '2s', max: '5s' },
        readDelay: { min: '1s', max: '3s' }
    },
    debugLogs: false,
    proxy: {
        enable: false,
        url: '',
        port: '',
        username: '',
        password: '',
        queryEngine: false
    },
    consoleLogFilter: {
        enabled: false,
        mode: 'blacklist',
        levels: ['error'],
        keywords: [],
        regexPatterns: []
    },
    webhook: {
        discord: { enabled: false, url: '' },
        webhookLogFilter: {
            enabled: false,
            mode: 'blacklist',
            levels: ['error'],
            keywords: [],
            regexPatterns: []
        }
    },
    geminiApiKey: '',
    geminiModel: 'gemini-1.5-flash',
    geminiEndpoint: 'https://generativelanguage.googleapis.com'
});
// Account
export const AccountSchema = z.object({
    email: z.string(),
    password: z.string().optional().default(''),
    totpSecret: z.string().optional(),
    recoveryEmail: z.string().optional().default(''),
    geoLocale: z.string().optional().default('auto'),
    langCode: z.string().optional().default('en'),
    proxy: z.object({
        proxyAxios: z.boolean().optional().default(false),
        url: z.string().optional().default(''),
        port: z.coerce.number().optional().default(0),
        password: z.string().optional().default(''),
        username: z.string().optional().default('')
    }).optional().default({
        proxyAxios: false,
        url: '',
        port: 0,
        password: '',
        username: ''
    }),
    saveFingerprint: z.object({
        mobile: z.boolean().optional().default(true),
        desktop: z.boolean().optional().default(true)
    }).optional().default({
        mobile: true,
        desktop: true
    }),
    points: z.number().optional().default(0),
    initialPoints: z.number().optional().default(0),
    collectedPoints: z.number().optional().default(0),
    duration: z.number().optional().default(0),
    rank: z.string().optional().default(''),
    lastUpdate: z.string().optional().default('Never')
});
export function validateConfig(data) {
    return ConfigSchema.parse(data);
}
export function validateAccounts(data) {
    return z.array(AccountSchema).parse(data);
}
export function checkNodeVersion() {
    try {
        const requiredVersion = pkg.engines?.node;
        if (!requiredVersion) {
            console.warn('No Node.js version requirement found in package.json "engines" field.');
            return;
        }
        if (!semver.satisfies(process.version, requiredVersion)) {
            console.error(`Current Node.js version ${process.version} does not satisfy requirement: ${requiredVersion}`);
            process.exit(1);
        }
    }
    catch (error) {
        console.error('Failed to validate Node.js version:', error);
        process.exit(1);
    }
}
//# sourceMappingURL=Validator.js.map