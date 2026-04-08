"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountSchema = exports.ConfigSchema = void 0;
exports.validateConfig = validateConfig;
exports.validateAccounts = validateAccounts;
exports.checkNodeVersion = checkNodeVersion;
const zod_1 = require("zod");
const semver_1 = __importDefault(require("semver"));
const package_json_1 = __importDefault(require("../../package.json"));
const NumberOrString = zod_1.z.union([zod_1.z.number(), zod_1.z.string()]);
const LogFilterSchema = zod_1.z.object({
    enabled: zod_1.z.boolean().default(false),
    mode: zod_1.z.enum(['whitelist', 'blacklist']).default('blacklist'),
    levels: zod_1.z.array(zod_1.z.enum(['debug', 'info', 'warn', 'error'])).optional().default(['error']),
    keywords: zod_1.z.array(zod_1.z.string()).optional().default([]),
    regexPatterns: zod_1.z.array(zod_1.z.string()).optional().default([])
}).default({
    enabled: false,
    mode: 'blacklist',
    levels: ['error'],
    keywords: [],
    regexPatterns: []
});
const DelaySchema = zod_1.z.object({
    min: NumberOrString,
    max: NumberOrString
});
const QueryEngineSchema = zod_1.z.enum(['google', 'wikipedia', 'reddit', 'local', 'gemini']);
// Webhook
const WebhookSchema = zod_1.z.object({
    discord: zod_1.z
        .object({
        enabled: zod_1.z.boolean().default(false),
        url: zod_1.z.string().default('')
    })
        .optional()
        .default({ enabled: false, url: '' }),
    ntfy: zod_1.z
        .object({
        enabled: zod_1.z.boolean().optional().default(false),
        url: zod_1.z.string().default(''),
        topic: zod_1.z.string().optional(),
        token: zod_1.z.string().optional(),
        title: zod_1.z.string().optional(),
        tags: zod_1.z.array(zod_1.z.string()).optional(),
        priority: zod_1.z.union([zod_1.z.literal(1), zod_1.z.literal(2), zod_1.z.literal(3), zod_1.z.literal(4), zod_1.z.literal(5)]).optional()
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
exports.ConfigSchema = zod_1.z.object({
    baseURL: zod_1.z.string().optional().default('https://rewards.bing.com'),
    sessionPath: zod_1.z.string().optional().default('sessions'),
    headless: zod_1.z.boolean().optional().default(false),
    browserType: zod_1.z.enum(['chromium', 'edge']).optional().default('chromium'),
    runOnZeroPoints: zod_1.z.boolean().optional().default(false),
    clusters: zod_1.z.number().int().nonnegative().optional().default(1),
    errorDiagnostics: zod_1.z.boolean().optional().default(true),
    workers: zod_1.z.object({
        doDailySet: zod_1.z.boolean().optional().default(true),
        doSpecialPromotions: zod_1.z.boolean().optional().default(true),
        doMorePromotions: zod_1.z.boolean().optional().default(true),
        doPunchCards: zod_1.z.boolean().optional().default(true),
        doAppPromotions: zod_1.z.boolean().optional().default(true),
        doDesktopSearch: zod_1.z.boolean().optional().default(true),
        doMobileSearch: zod_1.z.boolean().optional().default(true),
        doDailyCheckIn: zod_1.z.boolean().optional().default(true),
        doReadToEarn: zod_1.z.boolean().optional().default(true)
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
    searchOnBingLocalQueries: zod_1.z.boolean().optional().default(false),
    globalTimeout: NumberOrString.optional().default(120000),
    searchSettings: zod_1.z.object({
        scrollRandomResults: zod_1.z.boolean().optional().default(true),
        clickRandomResults: zod_1.z.boolean().optional().default(true),
        parallelSearching: zod_1.z.boolean().optional().default(false),
        queryEngines: zod_1.z.array(QueryEngineSchema).optional().default(['google', 'wikipedia', 'reddit', 'local']),
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
    debugLogs: zod_1.z.boolean().optional().default(false),
    proxy: zod_1.z.object({
        enable: zod_1.z.boolean().optional().default(false),
        url: zod_1.z.string().optional().default(''),
        port: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).optional().default(''),
        username: zod_1.z.string().optional().default(''),
        password: zod_1.z.string().optional().default(''),
        queryEngine: zod_1.z.boolean().optional().default(false)
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
    geminiApiKey: zod_1.z.string().optional().default(''),
    geminiModel: zod_1.z.string().optional().default('gemini-1.5-flash'),
    geminiEndpoint: zod_1.z.string().optional().default('https://generativelanguage.googleapis.com')
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
exports.AccountSchema = zod_1.z.object({
    email: zod_1.z.string(),
    password: zod_1.z.string().optional().default(''),
    totpSecret: zod_1.z.string().optional(),
    recoveryEmail: zod_1.z.string().optional().default(''),
    geoLocale: zod_1.z.string().optional().default('auto'),
    langCode: zod_1.z.string().optional().default('en'),
    proxy: zod_1.z.object({
        proxyAxios: zod_1.z.boolean().optional().default(false),
        url: zod_1.z.string().optional().default(''),
        port: zod_1.z.coerce.number().optional().default(0),
        password: zod_1.z.string().optional().default(''),
        username: zod_1.z.string().optional().default('')
    }).optional().default({
        proxyAxios: false,
        url: '',
        port: 0,
        password: '',
        username: ''
    }),
    saveFingerprint: zod_1.z.object({
        mobile: zod_1.z.boolean().optional().default(true),
        desktop: zod_1.z.boolean().optional().default(true)
    }).optional().default({
        mobile: true,
        desktop: true
    }),
    points: zod_1.z.number().optional().default(0),
    initialPoints: zod_1.z.number().optional().default(0),
    collectedPoints: zod_1.z.number().optional().default(0),
    duration: zod_1.z.number().optional().default(0),
    rank: zod_1.z.string().optional().default(''),
    lastUpdate: zod_1.z.string().optional().default('Never')
});
function validateConfig(data) {
    return exports.ConfigSchema.parse(data);
}
function validateAccounts(data) {
    return zod_1.z.array(exports.AccountSchema).parse(data);
}
function checkNodeVersion() {
    try {
        const requiredVersion = package_json_1.default.engines?.node;
        if (!requiredVersion) {
            console.warn('No Node.js version requirement found in package.json "engines" field.');
            return;
        }
        if (!semver_1.default.satisfies(process.version, requiredVersion)) {
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