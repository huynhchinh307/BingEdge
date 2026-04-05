import { z } from 'zod'
import semver from 'semver'
import pkg from '../../package.json'

import { Config } from '../interface/Config'
import { Account } from '../interface/Account'

const NumberOrString = z.union([z.number(), z.string()])

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
})

const DelaySchema = z.object({
    min: NumberOrString,
    max: NumberOrString
})

const QueryEngineSchema = z.enum(['google', 'wikipedia', 'reddit', 'local', 'gemini'])

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
})

// Config
export const ConfigSchema = z.object({
    baseURL: z.string(),
    sessionPath: z.string(),
    headless: z.boolean(),
    browserType: z.enum(['chromium', 'edge']).optional().default('chromium'),
    runOnZeroPoints: z.boolean().optional().default(false),
    clusters: z.number().int().nonnegative(),
    errorDiagnostics: z.boolean().default(true),
    workers: z.object({
        doDailySet: z.boolean().default(true),
        doSpecialPromotions: z.boolean().default(true),
        doMorePromotions: z.boolean().default(true),
        doPunchCards: z.boolean().default(true),
        doAppPromotions: z.boolean().default(true),
        doDesktopSearch: z.boolean().default(true),
        doMobileSearch: z.boolean().default(true),
        doDailyCheckIn: z.boolean().default(true),
        doReadToEarn: z.boolean().default(true)
    }).default({
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
    searchOnBingLocalQueries: z.boolean().default(false),
    globalTimeout: NumberOrString.default(120000),
    searchSettings: z.object({
        scrollRandomResults: z.boolean().default(true),
        clickRandomResults: z.boolean().default(true),
        parallelSearching: z.boolean().default(false),
        queryEngines: z.array(QueryEngineSchema).default(['google', 'wikipedia', 'reddit', 'local']),
        searchResultVisitTime: NumberOrString.default('5-10s'),
        searchDelay: DelaySchema.default({ min: '2s', max: '5s' }),
        readDelay: DelaySchema.default({ min: '1s', max: '3s' })
    }).default({
        scrollRandomResults: true,
        clickRandomResults: true,
        parallelSearching: false,
        queryEngines: ['google', 'wikipedia', 'reddit', 'local'],
        searchResultVisitTime: '5-10s',
        searchDelay: { min: '2s', max: '5s' },
        readDelay: { min: '1s', max: '3s' }
    }),
    debugLogs: z.boolean().default(false),
    proxy: z.object({
        queryEngine: z.boolean().default(false)
    }).default({
        queryEngine: false
    }),
    consoleLogFilter: LogFilterSchema,
    webhook: WebhookSchema,
    geminiApiKey: z.string().optional(),
    geminiModel: z.string().optional(),
    geminiEndpoint: z.string().optional()
})

// Account
export const AccountSchema = z.object({
    email: z.string(),
    password: z.string(),
    totpSecret: z.string().optional(),
    recoveryEmail: z.string(),
    geoLocale: z.string(),
    langCode: z.string(),
    proxy: z.object({
        proxyAxios: z.boolean(),
        url: z.string(),
        port: z.number(),
        password: z.string(),
        username: z.string()
    }),
    saveFingerprint: z.object({
        mobile: z.boolean(),
        desktop: z.boolean()
    }),
    points: z.number().optional(),
    lastUpdate: z.string().optional()
})

export function validateConfig(data: unknown): Config {
    return ConfigSchema.parse(data) as Config
}

export function validateAccounts(data: unknown): Account[] {
    return z.array(AccountSchema).parse(data)
}

export function checkNodeVersion(): void {
    try {
        const requiredVersion = pkg.engines?.node

        if (!requiredVersion) {
            console.warn('No Node.js version requirement found in package.json "engines" field.')
            return
        }

        if (!semver.satisfies(process.version, requiredVersion)) {
            console.error(`Current Node.js version ${process.version} does not satisfy requirement: ${requiredVersion}`)
            process.exit(1)
        }
    } catch (error) {
        console.error('Failed to validate Node.js version:', error)
        process.exit(1)
    }
}
