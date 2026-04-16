import { AsyncLocalStorage } from 'node:async_hooks'
import fs from 'node:fs'
import path from 'node:path'
import cluster, { Worker } from 'cluster'
import type { BrowserContext, Cookie, Page } from 'patchright'
import pkg from '../package.json' with { type: 'json' }

import type { BrowserFingerprintWithHeaders } from 'fingerprint-generator'

import Browser from './browser/Browser'
import BrowserFunc from './browser/BrowserFunc'
import BrowserUtils from './browser/BrowserUtils'

import { IpcLog, Logger } from './logging/Logger'
import Utils from './util/Utils'
import { loadAccounts, loadConfig, saveAccounts, updateAccountStatus } from './util/Load'
import { checkNodeVersion } from './util/Validator'

import { Login } from './browser/auth/Login'
import { Workers } from './functions/Workers'
import Activities from './functions/Activities'
import { SearchManager } from './functions/SearchManager'

import type { Account } from './interface/Account'
import AxiosClient from './util/Axios'
import { sendDiscord, flushDiscordQueue } from './logging/Discord'
import { sendNtfy, flushNtfyQueue } from './logging/Ntfy'
import type { DashboardData } from './interface/DashboardData'
import type { AppDashboardData } from './interface/AppDashBoardData'

interface ExecutionContext {
    isMobile: boolean
    account: Account
}

interface BrowserSession {
    context: BrowserContext
    fingerprint: BrowserFingerprintWithHeaders
}

interface AccountStats {
    email: string
    initialPoints: number
    finalPoints: number
    collectedPoints: number
    duration: number
    rank?: string
    success: boolean
    error?: string
}

const executionContext = new AsyncLocalStorage<ExecutionContext>()

export function getCurrentContext(): ExecutionContext {
    const context = executionContext.getStore()
    if (!context) {
        return { isMobile: false, account: {} as any }
    }
    return context
}

async function flushAllWebhooks(timeoutMs = 5000): Promise<void> {
    await Promise.allSettled([flushDiscordQueue(timeoutMs), flushNtfyQueue(timeoutMs)])
}

interface UserData {
    userName: string
    geoLocale: string
    langCode: string
    initialPoints: number
    currentPoints: number
    gainedPoints: number
}

export class MicrosoftRewardsBot {
    public logger: Logger
    public config
    public utils: Utils
    public activities: Activities = new Activities(this)
    public browser: { func: BrowserFunc; utils: BrowserUtils }

    public mainMobilePage!: Page
    public mainDesktopPage!: Page

    public userData: UserData

    public rewardsVersion: 'legacy' | 'modern' = 'legacy'

    public accessToken = ''
    public requestToken = ''
    public cookies: { mobile: Cookie[]; desktop: Cookie[] }
    public fingerprint!: BrowserFingerprintWithHeaders

    private pointsCanCollect = 0

    private activeWorkers: number
    private exitedWorkers: number[]
    private browserFactory: Browser = new Browser(this)
    private accounts: Account[]
    public workers: Workers
    private login = new Login(this)
    private searchManager: SearchManager

    public axios!: AxiosClient

    constructor() {
        this.userData = {
            userName: '',
            geoLocale: 'US',
            langCode: 'en',
            initialPoints: 0,
            currentPoints: 0,
            gainedPoints: 0
        }
        this.logger = new Logger(this)
        this.accounts = []
        this.cookies = { mobile: [], desktop: [] }
        this.utils = new Utils()
        this.workers = new Workers(this)
        this.searchManager = new SearchManager(this)
        this.browser = {
            func: new BrowserFunc(this),
            utils: new BrowserUtils(this)
        }
        this.config = loadConfig()
        this.activeWorkers = this.config.clusters
        this.exitedWorkers = []
    }

    get isMobile(): boolean {
        return getCurrentContext().isMobile
    }

    async initialize(): Promise<void> {
        this.accounts = loadAccounts()
    }

    async run(): Promise<void> {
        let accountsToRun = this.accounts
        const emailIndex = process.argv.indexOf('-email')
        if (emailIndex !== -1 && emailIndex + 1 < process.argv.length) {
            const targetEmail = process.argv[emailIndex + 1]
            if (targetEmail) {
                accountsToRun = this.accounts.filter((a: Account) => a.email.toLowerCase() === targetEmail.toLowerCase())
            }
        }

        const totalAccounts = accountsToRun.length
        const runStartTime = Date.now()

        this.logger.info(
            'main',
            'RUN-START',
            `Starting Microsoft Rewards Script | v${pkg.version} | Accounts: ${totalAccounts} | Clusters: ${this.config.clusters}`
        )

        if (cluster.isPrimary && this.config.searchSettings.queryEngines.includes('gemini')) {
            const ok = await this.testGeminiConnection()
            if (!ok) {
                this.logger.error('main', 'GEMINI-INIT', 'Gemini AI connection test failed. Bot will not start to prevent invalid searches.')
                await flushAllWebhooks()
                process.exit(1)
            }
            this.logger.info('main', 'GEMINI-INIT', 'Gemini AI connection verified successfully.')
        }

        if (this.config.clusters > 1) {
            if (cluster.isPrimary) {
                this.runMaster(accountsToRun, runStartTime)
            } else {
                this.runWorker(runStartTime)
            }
        } else {
            await this.runTasks(accountsToRun, runStartTime)
        }
    }

    private async testGeminiConnection(): Promise<boolean> {
        const apiKey = this.config.geminiApiKey
        const model = this.config.geminiModel || 'gemini-1.5-flash'
        const endpoint = (this.config.geminiEndpoint || 'https://generativelanguage.googleapis.com').replace(/\/$/, '')
        
        if (!apiKey) {
            this.logger.error('main', 'GEMINI-CHECK', 'Gemini API Key is missing in config.json!')
            return false
        }

        this.logger.info('main', 'GEMINI-CHECK', 'Testing Gemini API connectivity...')

        const isOpenAI = endpoint.includes('/v1') && !endpoint.includes('generativelanguage.googleapis.com')
        const axios = new AxiosClient({} as any) // Global test, proxy bypassed if not configured in request
        
        try {
            let url = ''
            let data: any = {}
            let headers: any = { 'Content-Type': 'application/json' }

            if (isOpenAI) {
                url = `${endpoint}/chat/completions`
                headers['Authorization'] = `Bearer ${apiKey}`
                data = {
                    model: model,
                    messages: [{ role: 'user', content: 'Say OK' }],
                    max_tokens: 5
                }
            } else {
                const cleanModel = model.replace(/^models\//, '')
                url = `${endpoint}/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`
                data = {
                    contents: [{ parts: [{ text: 'Say OK' }] }],
                    generationConfig: { maxOutputTokens: 5 }
                }
            }

            await axios.request({
                url,
                method: 'POST',
                headers,
                data,
                timeout: 10000
            }, !this.config.proxy.queryEngine)
            return true
        } catch (e: any) {
            const detail = e.response?.data?.error?.message || e.response?.data?.error || e.message
            this.logger.error('main', 'GEMINI-CHECK', `API Test Failed | URL: ${endpoint} | Error: ${typeof detail === 'object' ? JSON.stringify(detail) : detail}`)
            return false
        }
    }

    private runMaster(accounts: Account[], runStartTime: number): void {
        void this.logger.info('main', 'CLUSTER-PRIMARY', `Primary process started | PID: ${process.pid}`)

        // Group accounts by proxy to ensure "1 account per proxy" at a time across clusters
        const proxyGroups = new Map<string, Account[]>()
        for (const account of accounts) {
            const proxyKey = this.getProxyKey(account)
            
            if (!proxyGroups.has(proxyKey)) {
                proxyGroups.set(proxyKey, [])
            }
            proxyGroups.get(proxyKey)!.push(account)
        }

        if (proxyGroups.size < accounts.length) {
            this.logger.info('main', 'CLUSTER-PRIMARY', `Grouped ${accounts.length} accounts into ${proxyGroups.size} proxy groups to prevent simultaneous use of the same IP.`)
        }

        // Distribute groups across clusters to balance the workload (account count)
        const workerChunks: Account[][] = Array.from({ length: this.config.clusters }, () => [])
        const sortedGroups = [...proxyGroups.values()].sort((a, b) => b.length - a.length)

        for (const group of sortedGroups) {
            // Assign each group to the worker that currently has the fewest accounts assigned
            const targetWorker = workerChunks.reduce((min, cur) => (cur.length < min!.length ? cur : min), workerChunks[0])
            targetWorker!.push(...group)
        }

        const accountChunks = workerChunks.filter(c => c && c.length > 0)
        this.activeWorkers = accountChunks.length

        const allAccountStats: AccountStats[] = []

        for (const chunk of accountChunks) {
            const worker = cluster.fork()
            worker.send?.({ chunk, runStartTime })

            worker.on('message', (msg: { __ipcLog?: IpcLog; __stats?: AccountStats[] }) => {
                if (msg.__stats) {
                    allAccountStats.push(...msg.__stats)
                    
                    // Update master account list with new points
                    msg.__stats.forEach(s => {
                        const acc = this.accounts.find(a => a.email.toLowerCase() === s.email.toLowerCase())
                        if (acc) {
                            acc.points = s.finalPoints
                            acc.initialPoints = s.initialPoints
                            acc.collectedPoints = s.collectedPoints
                            acc.duration = s.duration
                            acc.rank = s.rank
                            acc.lastUpdate = new Date().toISOString()
                        }
                    })
                    // Periodically save
                    saveAccounts(this.accounts)
                }
                
                const log = msg.__ipcLog

                if (log && typeof log.content === 'string') {
                    const config = this.config
                    const webhook = config.webhook
                    const content = log.content
                    const level = log.level
                    if (webhook.discord?.enabled && webhook.discord.url) {
                        sendDiscord(webhook.discord.url, content, level)
                    }
                    if (webhook.ntfy?.enabled && webhook.ntfy.url) {
                        sendNtfy(webhook.ntfy, content, level)
                    }
                }
            })
        }

        const onWorkerDone = async (label: 'exit' | 'disconnect', worker: Worker, code?: number): Promise<void> => {
            const { pid } = worker.process
            this.activeWorkers -= 1

            if (!pid || this.exitedWorkers.includes(pid)) {
                return
            } else {
                this.exitedWorkers.push(pid)
            }

            this.logger.warn(
                'main',
                `CLUSTER-WORKER-${label.toUpperCase()}`,
                `Worker ${worker.process?.pid ?? '?'} ${label} | Code: ${code ?? 'n/a'} | Active workers: ${this.activeWorkers}`
            )
            if (this.activeWorkers <= 0) {
                const totalCollectedPoints = allAccountStats.reduce((sum, s) => sum + s.collectedPoints, 0)
                const totalInitialPoints = allAccountStats.reduce((sum, s) => sum + s.initialPoints, 0)
                const totalFinalPoints = allAccountStats.reduce((sum, s) => sum + s.finalPoints, 0)
                const totalDurationMinutes = ((Date.now() - runStartTime) / 1000 / 60).toFixed(1)

                this.logger.info(
                    'main',
                    'RUN-END',
                    `Completed all accounts | Accounts processed: ${allAccountStats.length} | Total points collected: +${totalCollectedPoints} | Old total: ${totalInitialPoints} → New total: ${totalFinalPoints} | Total runtime: ${totalDurationMinutes}min`,
                    'green'
                )
                await flushAllWebhooks()
                process.exit(code ?? 0)
            }
        }

        cluster.on('exit', (worker, code) => {
            void onWorkerDone('exit', worker, code)
        })
        cluster.on('disconnect', worker => {
            void onWorkerDone('disconnect', worker, undefined)
        })
    }

    private runWorker(runStartTimeFromMaster?: number): void {
        void this.logger.info('main', 'CLUSTER-WORKER-START', `Worker spawned | PID: ${process.pid}`)
        process.on('message', async ({ chunk, runStartTime }: { chunk: Account[]; runStartTime: number }) => {
            void this.logger.info(
                'main',
                'CLUSTER-WORKER-TASK',
                `Worker ${process.pid} received ${chunk.length} accounts.`
            )
            try {
                const stats = await this.runTasks(chunk, runStartTime ?? runStartTimeFromMaster ?? Date.now())
                if (process.send) {
                    process.send({ __stats: stats })
                }

                process.disconnect()
            } catch (error) {
                this.logger.error(
                    'main',
                    'CLUSTER-WORKER-ERROR',
                    `Worker task crash: ${error instanceof Error ? error.message : String(error)}`
                )
                await flushAllWebhooks()
                process.exit(1)
            }
        })
    }

    private async runTasks(accounts: Account[], runStartTime: number): Promise<AccountStats[]> {
        const accountStats: AccountStats[] = []
        const queue: Account[] = [...accounts]

        while (queue.length > 0) {
            const account = queue.shift()!
            const proxyKey = this.getProxyKey(account)

            // Try to acquire global lock for this proxy
            if (await this.acquireProxyLock(proxyKey)) {
                try {
                    const accountStartTime = Date.now()
                    const accountEmail = account.email
                    this.userData.userName = this.utils.getEmailUsername(accountEmail)

                    this.logger.info(
                        'main',
                        'ACCOUNT-START',
                        `Starting account: ${accountEmail} | geoLocale: ${account.geoLocale}`
                    )

                    this.axios = new AxiosClient(account.proxy)

                    const result = await this.Main(account).catch(error => {
                        void this.logger.error(
                            true,
                            'FLOW',
                            `Mobile flow failed for ${accountEmail}: ${error instanceof Error ? error.message : String(error)}`
                        )
                        return undefined
                    })

                    const durationSeconds = ((Date.now() - accountStartTime) / 1000).toFixed(1)

                    if (result) {
                        const collectedPoints = result.collectedPoints ?? 0
                        const accountInitialPoints = result.initialPoints ?? 0
                        const accountFinalPoints = accountInitialPoints + collectedPoints

                        account.points = accountFinalPoints
                        account.initialPoints = accountInitialPoints
                        account.collectedPoints = collectedPoints
                        account.duration = parseFloat(durationSeconds)
                        account.rank = result.rank
                        account.lastUpdate = new Date().toISOString()
                        
                        // Ghi status riêng theo email — tránh race condition khi nhiều worker cùng ghi accounts.json
                        updateAccountStatus(accountEmail, {
                            points: accountFinalPoints,
                            initialPoints: accountInitialPoints,
                            collectedPoints: collectedPoints,
                            duration: parseFloat(durationSeconds),
                            rank: result.rank,
                            lastUpdate: account.lastUpdate
                        })
                        
                        const stats: AccountStats = {
                            email: accountEmail,
                            initialPoints: accountInitialPoints,
                            finalPoints: accountFinalPoints,
                            collectedPoints: collectedPoints,
                            duration: parseFloat(durationSeconds),
                            rank: result.rank,
                            success: true
                        }
                        accountStats.push(stats)

                        this.logger.info(
                            'main',
                            'ACCOUNT-END',
                            `Completed account: ${accountEmail} | Total: +${collectedPoints} | Old: ${accountInitialPoints} → New: ${accountFinalPoints} | Rank: ${result.rank || 'N/A'} | Duration: ${durationSeconds}s`,
                            'green'
                        )
                    } else {
                        accountStats.push({
                            email: accountEmail,
                            initialPoints: 0,
                            finalPoints: 0,
                            collectedPoints: 0,
                            duration: parseFloat(durationSeconds),
                            success: false,
                            error: 'Flow failed'
                        })
                    }
                } finally {
                    this.releaseProxyLock(proxyKey)
                }
            } else {
                // Proxy is busy (another process is using it)
                if (queue.length > 0) {
                    // Put back to try other accounts in this worker's queue first
                    queue.push(account)
                    this.logger.info(
                        false,
                        'MAIN',
                        `Proxy ${proxyKey === 'NO_PROXY' ? 'No-Proxy' : proxyKey} is currently in use. Moving to next account in queue...`
                    )
                    await this.utils.wait(3000)
                } else {
                    // One of these might be true:
                    // 1. This is a single account run from Dashboard (accounts.length === 1)
                    // 2. This is the last account in a worker's chunk
                    
                    if (accounts.length === 1) {
                        this.logger.warn(
                            false,
                            'MAIN',
                            `[PROXY-BUSY] Proxy ${proxyKey === 'NO_PROXY' ? 'No-Proxy' : proxyKey} is currently in use. Exiting to allow dashboard to switch accounts...`
                        )
                        // Exit with 88 to signal Proxy Busy
                        process.exit(88)
                    } else {
                        // For multi-account clumps, we just wait a bit and retry
                        this.logger.warn(
                            false,
                            'MAIN',
                            `Proxy ${proxyKey === 'NO_PROXY' ? 'No-Proxy' : proxyKey} is currently in use. Waiting...`
                        )
                        await this.utils.wait(10000)
                        queue.unshift(account) // Try again later
                    }
                }
            }
        }

        if (this.config.clusters <= 1 && !cluster.isWorker) {
            const totalCollectedPoints = accountStats.reduce((sum, s) => sum + s.collectedPoints, 0)
            const totalInitialPoints = accountStats.reduce((sum, s) => sum + s.initialPoints, 0)
            const totalFinalPoints = accountStats.reduce((sum, s) => sum + s.finalPoints, 0)
            const totalDurationMinutes = ((Date.now() - runStartTime) / 1000 / 60).toFixed(1)

            this.logger.info(
                'main',
                'RUN-END',
                `Completed all accounts | Accounts processed: ${accountStats.length} | Total points collected: +${totalCollectedPoints} | Old total: ${totalInitialPoints} → New total: ${totalFinalPoints} | Total runtime: ${totalDurationMinutes}min`,
                'green'
            )
            await flushAllWebhooks()
        }

        return accountStats
    }

    private getProxyKey(account: Account): string {
        if (!account.proxy || !account.proxy.url) {
            return 'NO_PROXY'
        }
        // Normalize URL by stripping scheme prefix (http://, https://)
        let host = account.proxy.url.replace(/^(https?|socks[45]):\/\//i, '').toLowerCase().trim()
        let port = account.proxy.port
        
        // If host already contains a port (e.g. "1.2.3.4:8080"), extract it and use it if port is not set
        if (host.includes(':')) {
            const parts = host.split(':')
            if (parts[0]) host = parts[0]
            if (parts[1] && (!port || port === 0)) {
                port = parseInt(parts[1])
            }
        }

        return `${account.proxy.username || ''}@${host}:${port || 0}`
    }

    private async acquireProxyLock(proxyKey: string): Promise<boolean> {
        const lockDir = path.join(process.cwd(), '.locks')
        try {
            if (!fs.existsSync(lockDir)) {
                fs.mkdirSync(lockDir, { recursive: true })
            }
        } catch (e) {}

        const safeKey = Buffer.from(proxyKey).toString('base64').replace(/[/+=]/g, '_')
        const lockPath = path.join(lockDir, `${safeKey}.lock`)

        try {
            // Try to create the lock file atomically
            fs.writeFileSync(lockPath, process.pid.toString(), { flag: 'wx' })
            return true
        } catch (err: any) {
            if (err.code === 'EEXIST') {
                try {
                    const content = fs.readFileSync(lockPath, 'utf8').trim()
                    if (!content) {
                        fs.unlinkSync(lockPath)
                        return false
                    }
                    const pid = parseInt(content)
                    if (isNaN(pid)) {
                        fs.unlinkSync(lockPath)
                        return false
                    }
                    // Check if process is alive
                    try {
                        process.kill(pid, 0)
                        return pid === process.pid
                    } catch (e) {
                        // Dead process
                        fs.unlinkSync(lockPath)
                        return false
                    }
                } catch (e) {
                    return false
                }
            }
            return false
        }
    }

    private releaseProxyLock(proxyKey: string): void {
        try {
            const safeKey = Buffer.from(proxyKey).toString('base64').replace(/[/+=]/g, '_')
            const lockPath = path.join(process.cwd(), '.locks', `${safeKey}.lock`)
            if (fs.existsSync(lockPath)) {
                const pid = parseInt(fs.readFileSync(lockPath, 'utf8').trim())
                if (pid === process.pid) {
                    fs.unlinkSync(lockPath)
                }
            }
        } catch (e) {}
    }

    async Main(account: Account): Promise<{ initialPoints: number; collectedPoints: number; rank?: string }> {
        const accountEmail = account.email
        this.logger.info('main', 'FLOW', `Starting session for ${accountEmail}`)

        let mobileSession: BrowserSession | null = null
        let mobileContextClosed = false

        try {
            return await executionContext.run({ isMobile: true, account }, async () => {
                mobileSession = await this.browserFactory.createBrowser(account)
                const initialContext: BrowserContext = mobileSession.context
                this.mainMobilePage = await initialContext.newPage()

                this.logger.info('main', 'BROWSER', `Mobile Browser started | ${accountEmail}`)

                await this.login.login(this.mainMobilePage, account)

                try {
                    this.accessToken = await this.login.getAppAccessToken(this.mainMobilePage, accountEmail)
                } catch (error) {
                    this.logger.error(
                        'main',
                        'FLOW',
                        `Failed to get mobile access token: ${error instanceof Error ? error.message : String(error)}`
                    )
                }

                this.cookies.mobile = await initialContext.cookies()
                if (mobileSession) {
                    this.fingerprint = mobileSession.fingerprint
                }

                const data: DashboardData = await this.browser.func.getDashboardData()
                const appData: AppDashboardData = await this.browser.func.getAppDashboardData()

                // Set geo
                this.userData.geoLocale =
                    account.geoLocale === 'auto' ? data.userProfile.attributes.country : account.geoLocale.toLowerCase()
                this.userData.langCode = 
                    account.langCode ? account.langCode.toLowerCase() : 'en'

                if (this.userData.geoLocale.length > 2) {
                    this.logger.warn(
                        'main',
                        'GEO-LOCALE',
                        `The provided geoLocale is longer than 2 (${this.userData.geoLocale} | auto=${account.geoLocale === 'auto'}), this is likely invalid and can cause errors!`
                    )
                }

                this.userData.initialPoints = data.userStatus.availablePoints
                this.userData.currentPoints = data.userStatus.availablePoints
                const initialPoints = this.userData.initialPoints ?? 0

                const browserEarnable = await this.browser.func.getBrowserEarnablePoints()
                const appEarnable = await this.browser.func.getAppEarnablePoints()

                this.pointsCanCollect = browserEarnable.mobileSearchPoints + (appEarnable?.totalEarnablePoints ?? 0)

                this.logger.info(
                    'main',
                    'POINTS',
                    `Earnable today | Mobile: ${this.pointsCanCollect} | Browser: ${
                        browserEarnable.mobileSearchPoints
                    } | App: ${appEarnable?.totalEarnablePoints ?? 0} | ${accountEmail} | locale: ${this.userData.geoLocale}`
                )

                const activeWorkersList = Object.entries(this.config.workers)
                    .filter(([_, val]) => val === true)
                    .map(([key]) => key.replace('do', ''))
                    .join(', ')
                this.logger.info('main', 'FLOW', `Active workers for this session: [${activeWorkersList}]`)

                try {
                    if (this.config.workers.doAppPromotions) await this.workers.doAppPromotions(appData)
                } catch (e) {
                    this.logger.error('main', 'FLOW', `App Promotions error: ${e instanceof Error ? e.message : String(e)}`)
                }

                try {
                    if (this.config.workers.doDailyCheckIn) await this.activities.doDailyCheckIn()
                } catch (e) {
                    this.logger.error('main', 'FLOW', `Daily Check-in error: ${e instanceof Error ? e.message : String(e)}`)
                }

                try {
                    if (this.config.workers.doReadToEarn) await this.activities.doReadToEarn()
                } catch (e) {
                    this.logger.error('main', 'FLOW', `Read to Earn error: ${e instanceof Error ? e.message : String(e)}`)
                }

                // Solve promotions in mobile context
                if (this.config.workers.doDailySet && this.mainMobilePage) await this.workers.doDailySet(data, this.mainMobilePage as any)
                if (this.config.workers.doSpecialPromotions) await this.workers.doSpecialPromotions(data)
                if (this.config.workers.doMorePromotions && this.mainMobilePage) await this.workers.doMorePromotions(this.mainMobilePage as any)

                const searchPoints = await this.browser.func.getSearchPoints()
                const missingSearchPoints = this.browser.func.missingSearchPoints(searchPoints, true)

                this.cookies.mobile = await initialContext.cookies()

                const {
                    mobilePoints,
                    desktopPoints,
                    rank: desktopRank
                } = await this.searchManager.doSearches(data, missingSearchPoints, (mobileSession || {}) as any, account, accountEmail)

                mobileContextClosed = true

                let rank = desktopRank
                if (!rank) {
                    rank = this.browser.func.getAccountRank()
                }

                this.userData.gainedPoints = mobilePoints + desktopPoints

                const finalPoints = await this.browser.func.getCurrentPoints()
                const collectedPoints = finalPoints - initialPoints

                this.logger.info(
                    'main',
                    'FLOW',
                    `Collected: +${collectedPoints} | Mobile: +${mobilePoints} | Desktop: +${desktopPoints} | Rank: ${rank || 'N/A'} | ${accountEmail}`
                )

                return {
                    initialPoints,
                    collectedPoints: collectedPoints || 0,
                    rank: rank || ''
                }
            })
        } finally {
            if (mobileSession && !mobileContextClosed) {
                try {
                    await executionContext.run({ isMobile: true, account }, async () => {
                        await this.browser.func.closeBrowser(mobileSession!.context, accountEmail)
                    })
                } catch {}
            }
        }
    }
}

export { executionContext }

async function main(): Promise<void> {
    // Check before doing anything
    checkNodeVersion()
    const rewardsBot = new MicrosoftRewardsBot()

    process.on('beforeExit', () => {
        void flushAllWebhooks()
    })
    process.on('SIGINT', async () => {
        rewardsBot.logger.warn('main', 'PROCESS', 'SIGINT received, flushing and exiting...')
        await flushAllWebhooks()
        process.exit(130)
    })
    process.on('SIGTERM', async () => {
        rewardsBot.logger.warn('main', 'PROCESS', 'SIGTERM received, flushing and exiting...')
        await flushAllWebhooks()
        process.exit(143)
    })
    process.on('uncaughtException', async error => {
        rewardsBot.logger.error('main', 'UNCAUGHT-EXCEPTION', error)
        await flushAllWebhooks()
        process.exit(1)
    })
    process.on('unhandledRejection', async reason => {
        rewardsBot.logger.error('main', 'UNHANDLED-REJECTION', reason as Error)
        await flushAllWebhooks()
        process.exit(1)
    })

    try {
        await rewardsBot.initialize()
        await rewardsBot.run()
    } catch (error) {
        rewardsBot.logger.error('main', 'MAIN-ERROR', error as Error)
    }
}

main().catch(async error => {
    const tmpBot = new MicrosoftRewardsBot()
    tmpBot.logger.error('main', 'MAIN-ERROR', error as Error)
    await flushAllWebhooks()
    process.exit(1)
})
