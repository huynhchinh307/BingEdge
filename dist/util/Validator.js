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
    enabled: zod_1.z.boolean(),
    mode: zod_1.z.enum(['whitelist', 'blacklist']),
    levels: zod_1.z.array(zod_1.z.enum(['debug', 'info', 'warn', 'error'])).optional(),
    keywords: zod_1.z.array(zod_1.z.string()).optional(),
    regexPatterns: zod_1.z.array(zod_1.z.string()).optional()
});
const DelaySchema = zod_1.z.object({
    min: NumberOrString,
    max: NumberOrString
});
const QueryEngineSchema = zod_1.z.enum(['google', 'wikipedia', 'reddit', 'local']);
// Webhook
const WebhookSchema = zod_1.z.object({
    discord: zod_1.z
        .object({
        enabled: zod_1.z.boolean(),
        url: zod_1.z.string()
    })
        .optional(),
    ntfy: zod_1.z
        .object({
        enabled: zod_1.z.boolean().optional(),
        url: zod_1.z.string(),
        topic: zod_1.z.string().optional(),
        token: zod_1.z.string().optional(),
        title: zod_1.z.string().optional(),
        tags: zod_1.z.array(zod_1.z.string()).optional(),
        priority: zod_1.z.union([zod_1.z.literal(1), zod_1.z.literal(2), zod_1.z.literal(3), zod_1.z.literal(4), zod_1.z.literal(5)]).optional()
    })
        .optional(),
    webhookLogFilter: LogFilterSchema
});
// Config
exports.ConfigSchema = zod_1.z.object({
    baseURL: zod_1.z.string(),
    sessionPath: zod_1.z.string(),
    headless: zod_1.z.boolean(),
    browserType: zod_1.z.enum(['chromium', 'edge']).optional().default('chromium'),
    runOnZeroPoints: zod_1.z.boolean().optional().default(false),
    clusters: zod_1.z.number().int().nonnegative(),
    errorDiagnostics: zod_1.z.boolean(),
    workers: zod_1.z.object({
        doDailySet: zod_1.z.boolean(),
        doSpecialPromotions: zod_1.z.boolean(),
        doMorePromotions: zod_1.z.boolean(),
        doPunchCards: zod_1.z.boolean(),
        doAppPromotions: zod_1.z.boolean(),
        doDesktopSearch: zod_1.z.boolean(),
        doMobileSearch: zod_1.z.boolean(),
        doDailyCheckIn: zod_1.z.boolean(),
        doReadToEarn: zod_1.z.boolean()
    }),
    searchOnBingLocalQueries: zod_1.z.boolean(),
    globalTimeout: NumberOrString,
    searchSettings: zod_1.z.object({
        scrollRandomResults: zod_1.z.boolean(),
        clickRandomResults: zod_1.z.boolean(),
        parallelSearching: zod_1.z.boolean(),
        queryEngines: zod_1.z.array(QueryEngineSchema),
        searchResultVisitTime: NumberOrString,
        searchDelay: DelaySchema,
        readDelay: DelaySchema
    }),
    debugLogs: zod_1.z.boolean(),
    proxy: zod_1.z.object({
        queryEngine: zod_1.z.boolean()
    }),
    consoleLogFilter: LogFilterSchema,
    webhook: WebhookSchema
});
// Account
exports.AccountSchema = zod_1.z.object({
    email: zod_1.z.string(),
    password: zod_1.z.string(),
    totpSecret: zod_1.z.string().optional(),
    recoveryEmail: zod_1.z.string(),
    geoLocale: zod_1.z.string(),
    langCode: zod_1.z.string(),
    proxy: zod_1.z.object({
        proxyAxios: zod_1.z.boolean(),
        url: zod_1.z.string(),
        port: zod_1.z.number(),
        password: zod_1.z.string(),
        username: zod_1.z.string()
    }),
    saveFingerprint: zod_1.z.object({
        mobile: zod_1.z.boolean(),
        desktop: zod_1.z.boolean()
    }),
    points: zod_1.z.number().optional(),
    lastUpdate: zod_1.z.string().optional()
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