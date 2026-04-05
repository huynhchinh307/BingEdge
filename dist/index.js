"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.executionContext = exports.MicrosoftRewardsBot = void 0;
exports.getCurrentContext = getCurrentContext;
const node_async_hooks_1 = require("node:async_hooks");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const cluster_1 = __importDefault(require("cluster"));
const package_json_1 = __importDefault(require("../package.json"));
const Browser_1 = __importDefault(require("./browser/Browser"));
const BrowserFunc_1 = __importDefault(require("./browser/BrowserFunc"));
const BrowserUtils_1 = __importDefault(require("./browser/BrowserUtils"));
const Logger_1 = require("./logging/Logger");
const Utils_1 = __importDefault(require("./util/Utils"));
const Load_1 = require("./util/Load");
const Validator_1 = require("./util/Validator");
const Login_1 = require("./browser/auth/Login");
const Workers_1 = require("./functions/Workers");
const Activities_1 = __importDefault(require("./functions/Activities"));
const SearchManager_1 = require("./functions/SearchManager");
const Axios_1 = __importDefault(require("./util/Axios"));
const Discord_1 = require("./logging/Discord");
const Ntfy_1 = require("./logging/Ntfy");
const executionContext = new node_async_hooks_1.AsyncLocalStorage();
exports.executionContext = executionContext;
function getCurrentContext() {
    const context = executionContext.getStore();
    if (!context) {
        return { isMobile: false, account: {} };
    }
    return context;
}
async function flushAllWebhooks(timeoutMs = 5000) {
    await Promise.allSettled([(0, Discord_1.flushDiscordQueue)(timeoutMs), (0, Ntfy_1.flushNtfyQueue)(timeoutMs)]);
}
class MicrosoftRewardsBot {
    constructor() {
        this.activities = new Activities_1.default(this);
        this.rewardsVersion = 'legacy';
        this.accessToken = '';
        this.requestToken = '';
        this.pointsCanCollect = 0;
        this.browserFactory = new Browser_1.default(this);
        this.login = new Login_1.Login(this);
        this.userData = {
            userName: '',
            geoLocale: 'US',
            langCode: 'en',
            initialPoints: 0,
            currentPoints: 0,
            gainedPoints: 0
        };
        this.logger = new Logger_1.Logger(this);
        this.accounts = [];
        this.cookies = { mobile: [], desktop: [] };
        this.utils = new Utils_1.default();
        this.workers = new Workers_1.Workers(this);
        this.searchManager = new SearchManager_1.SearchManager(this);
        this.browser = {
            func: new BrowserFunc_1.default(this),
            utils: new BrowserUtils_1.default(this)
        };
        this.config = (0, Load_1.loadConfig)();
        this.activeWorkers = this.config.clusters;
        this.exitedWorkers = [];
    }
    get isMobile() {
        return getCurrentContext().isMobile;
    }
    async initialize() {
        this.accounts = (0, Load_1.loadAccounts)();
    }
    async run() {
        let accountsToRun = this.accounts;
        const emailIndex = process.argv.indexOf('-email');
        if (emailIndex !== -1 && emailIndex + 1 < process.argv.length) {
            const targetEmail = process.argv[emailIndex + 1];
            if (targetEmail) {
                accountsToRun = this.accounts.filter((a) => a.email.toLowerCase() === targetEmail.toLowerCase());
            }
        }
        const totalAccounts = accountsToRun.length;
        const runStartTime = Date.now();
        this.logger.info('main', 'RUN-START', `Starting Microsoft Rewards Script | v${package_json_1.default.version} | Accounts: ${totalAccounts} | Clusters: ${this.config.clusters}`);
        if (cluster_1.default.isPrimary && this.config.searchSettings.queryEngines.includes('gemini')) {
            const ok = await this.testGeminiConnection();
            if (!ok) {
                this.logger.error('main', 'GEMINI-INIT', 'Gemini AI connection test failed. Bot will not start to prevent invalid searches.');
                await flushAllWebhooks();
                process.exit(1);
            }
            this.logger.info('main', 'GEMINI-INIT', 'Gemini AI connection verified successfully.');
        }
        if (this.config.clusters > 1) {
            if (cluster_1.default.isPrimary) {
                this.runMaster(accountsToRun, runStartTime);
            }
            else {
                this.runWorker(runStartTime);
            }
        }
        else {
            await this.runTasks(accountsToRun, runStartTime);
        }
    }
    async testGeminiConnection() {
        const apiKey = this.config.geminiApiKey;
        const model = this.config.geminiModel || 'gemini-1.5-flash';
        const endpoint = (this.config.geminiEndpoint || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
        if (!apiKey) {
            this.logger.error('main', 'GEMINI-CHECK', 'Gemini API Key is missing in config.json!');
            return false;
        }
        this.logger.info('main', 'GEMINI-CHECK', 'Testing Gemini API connectivity...');
        const isOpenAI = endpoint.includes('/v1') && !endpoint.includes('generativelanguage.googleapis.com');
        const axios = new Axios_1.default({}); // Global test, proxy bypassed if not configured in request
        try {
            let url = '';
            let data = {};
            let headers = { 'Content-Type': 'application/json' };
            if (isOpenAI) {
                url = `${endpoint}/chat/completions`;
                headers['Authorization'] = `Bearer ${apiKey}`;
                data = {
                    model: model,
                    messages: [{ role: 'user', content: 'Say OK' }],
                    max_tokens: 5
                };
            }
            else {
                const cleanModel = model.replace(/^models\//, '');
                url = `${endpoint}/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;
                data = {
                    contents: [{ parts: [{ text: 'Say OK' }] }],
                    generationConfig: { maxOutputTokens: 5 }
                };
            }
            await axios.request({
                url,
                method: 'POST',
                headers,
                data,
                timeout: 10000
            }, !this.config.proxy.queryEngine);
            return true;
        }
        catch (e) {
            const detail = e.response?.data?.error?.message || e.response?.data?.error || e.message;
            this.logger.error('main', 'GEMINI-CHECK', `API Test Failed | URL: ${endpoint} | Error: ${typeof detail === 'object' ? JSON.stringify(detail) : detail}`);
            return false;
        }
    }
    runMaster(accounts, runStartTime) {
        void this.logger.info('main', 'CLUSTER-PRIMARY', `Primary process started | PID: ${process.pid}`);
        // Group accounts by proxy to ensure "1 account per proxy" at a time across clusters
        const proxyGroups = new Map();
        for (const account of accounts) {
            const proxyKey = this.getProxyKey(account);
            if (!proxyGroups.has(proxyKey)) {
                proxyGroups.set(proxyKey, []);
            }
            proxyGroups.get(proxyKey).push(account);
        }
        if (proxyGroups.size < accounts.length) {
            this.logger.info('main', 'CLUSTER-PRIMARY', `Grouped ${accounts.length} accounts into ${proxyGroups.size} proxy groups to prevent simultaneous use of the same IP.`);
        }
        // Distribute groups across clusters to balance the workload (account count)
        const workerChunks = Array.from({ length: this.config.clusters }, () => []);
        const sortedGroups = [...proxyGroups.values()].sort((a, b) => b.length - a.length);
        for (const group of sortedGroups) {
            // Assign each group to the worker that currently has the fewest accounts assigned
            const targetWorker = workerChunks.reduce((min, cur) => (cur.length < min.length ? cur : min), workerChunks[0]);
            targetWorker.push(...group);
        }
        const accountChunks = workerChunks.filter(c => c && c.length > 0);
        this.activeWorkers = accountChunks.length;
        const allAccountStats = [];
        for (const chunk of accountChunks) {
            const worker = cluster_1.default.fork();
            worker.send?.({ chunk, runStartTime });
            worker.on('message', (msg) => {
                if (msg.__stats) {
                    allAccountStats.push(...msg.__stats);
                    // Update master account list with new points
                    msg.__stats.forEach(s => {
                        const acc = this.accounts.find(a => a.email.toLowerCase() === s.email.toLowerCase());
                        if (acc) {
                            acc.points = s.finalPoints;
                            acc.initialPoints = s.initialPoints;
                            acc.collectedPoints = s.collectedPoints;
                            acc.duration = s.duration;
                            acc.rank = s.rank;
                            acc.lastUpdate = new Date().toISOString();
                        }
                    });
                    // Periodically save
                    (0, Load_1.saveAccounts)(this.accounts);
                }
                const log = msg.__ipcLog;
                if (log && typeof log.content === 'string') {
                    const config = this.config;
                    const webhook = config.webhook;
                    const content = log.content;
                    const level = log.level;
                    if (webhook.discord?.enabled && webhook.discord.url) {
                        (0, Discord_1.sendDiscord)(webhook.discord.url, content, level);
                    }
                    if (webhook.ntfy?.enabled && webhook.ntfy.url) {
                        (0, Ntfy_1.sendNtfy)(webhook.ntfy, content, level);
                    }
                }
            });
        }
        const onWorkerDone = async (label, worker, code) => {
            const { pid } = worker.process;
            this.activeWorkers -= 1;
            if (!pid || this.exitedWorkers.includes(pid)) {
                return;
            }
            else {
                this.exitedWorkers.push(pid);
            }
            this.logger.warn('main', `CLUSTER-WORKER-${label.toUpperCase()}`, `Worker ${worker.process?.pid ?? '?'} ${label} | Code: ${code ?? 'n/a'} | Active workers: ${this.activeWorkers}`);
            if (this.activeWorkers <= 0) {
                const totalCollectedPoints = allAccountStats.reduce((sum, s) => sum + s.collectedPoints, 0);
                const totalInitialPoints = allAccountStats.reduce((sum, s) => sum + s.initialPoints, 0);
                const totalFinalPoints = allAccountStats.reduce((sum, s) => sum + s.finalPoints, 0);
                const totalDurationMinutes = ((Date.now() - runStartTime) / 1000 / 60).toFixed(1);
                this.logger.info('main', 'RUN-END', `Completed all accounts | Accounts processed: ${allAccountStats.length} | Total points collected: +${totalCollectedPoints} | Old total: ${totalInitialPoints} → New total: ${totalFinalPoints} | Total runtime: ${totalDurationMinutes}min`, 'green');
                await flushAllWebhooks();
                process.exit(code ?? 0);
            }
        };
        cluster_1.default.on('exit', (worker, code) => {
            void onWorkerDone('exit', worker, code);
        });
        cluster_1.default.on('disconnect', worker => {
            void onWorkerDone('disconnect', worker, undefined);
        });
    }
    runWorker(runStartTimeFromMaster) {
        void this.logger.info('main', 'CLUSTER-WORKER-START', `Worker spawned | PID: ${process.pid}`);
        process.on('message', async ({ chunk, runStartTime }) => {
            void this.logger.info('main', 'CLUSTER-WORKER-TASK', `Worker ${process.pid} received ${chunk.length} accounts.`);
            try {
                const stats = await this.runTasks(chunk, runStartTime ?? runStartTimeFromMaster ?? Date.now());
                if (process.send) {
                    process.send({ __stats: stats });
                }
                process.disconnect();
            }
            catch (error) {
                this.logger.error('main', 'CLUSTER-WORKER-ERROR', `Worker task crash: ${error instanceof Error ? error.message : String(error)}`);
                await flushAllWebhooks();
                process.exit(1);
            }
        });
    }
    async runTasks(accounts, runStartTime) {
        const accountStats = [];
        const queue = [...accounts];
        while (queue.length > 0) {
            const account = queue.shift();
            const proxyKey = this.getProxyKey(account);
            // Try to acquire global lock for this proxy
            if (await this.acquireProxyLock(proxyKey)) {
                try {
                    const accountStartTime = Date.now();
                    const accountEmail = account.email;
                    this.userData.userName = this.utils.getEmailUsername(accountEmail);
                    this.logger.info('main', 'ACCOUNT-START', `Starting account: ${accountEmail} | geoLocale: ${account.geoLocale}`);
                    this.axios = new Axios_1.default(account.proxy);
                    const result = await this.Main(account).catch(error => {
                        void this.logger.error(true, 'FLOW', `Mobile flow failed for ${accountEmail}: ${error instanceof Error ? error.message : String(error)}`);
                        return undefined;
                    });
                    const durationSeconds = ((Date.now() - accountStartTime) / 1000).toFixed(1);
                    if (result) {
                        const collectedPoints = result.collectedPoints ?? 0;
                        const accountInitialPoints = result.initialPoints ?? 0;
                        const accountFinalPoints = accountInitialPoints + collectedPoints;
                        account.points = accountFinalPoints;
                        account.initialPoints = accountInitialPoints;
                        account.collectedPoints = collectedPoints;
                        account.duration = parseFloat(durationSeconds);
                        account.rank = result.rank;
                        account.lastUpdate = new Date().toISOString();
                        // Ghi status riêng theo email — tránh race condition khi nhiều worker cùng ghi accounts.json
                        (0, Load_1.updateAccountStatus)(accountEmail, {
                            points: accountFinalPoints,
                            initialPoints: accountInitialPoints,
                            collectedPoints: collectedPoints,
                            duration: parseFloat(durationSeconds),
                            rank: result.rank,
                            lastUpdate: account.lastUpdate
                        });
                        const stats = {
                            email: accountEmail,
                            initialPoints: accountInitialPoints,
                            finalPoints: accountFinalPoints,
                            collectedPoints: collectedPoints,
                            duration: parseFloat(durationSeconds),
                            rank: result.rank,
                            success: true
                        };
                        accountStats.push(stats);
                        this.logger.info('main', 'ACCOUNT-END', `Completed account: ${accountEmail} | Total: +${collectedPoints} | Old: ${accountInitialPoints} → New: ${accountFinalPoints} | Rank: ${result.rank || 'N/A'} | Duration: ${durationSeconds}s`, 'green');
                    }
                    else {
                        accountStats.push({
                            email: accountEmail,
                            initialPoints: 0,
                            finalPoints: 0,
                            collectedPoints: 0,
                            duration: parseFloat(durationSeconds),
                            success: false,
                            error: 'Flow failed'
                        });
                    }
                }
                finally {
                    this.releaseProxyLock(proxyKey);
                }
            }
            else {
                // Proxy is busy (another process is using it)
                if (queue.length > 0) {
                    // Put back to try other accounts in this worker's queue first
                    queue.push(account);
                    this.logger.info(false, 'MAIN', `Proxy ${proxyKey === 'NO_PROXY' ? 'No-Proxy' : proxyKey} is currently in use. Moving to next account in queue...`);
                    await this.utils.wait(3000);
                }
                else {
                    // One of these might be true:
                    // 1. This is a single account run from Dashboard (accounts.length === 1)
                    // 2. This is the last account in a worker's chunk
                    if (accounts.length === 1) {
                        this.logger.warn(false, 'MAIN', `[PROXY-BUSY] Proxy ${proxyKey === 'NO_PROXY' ? 'No-Proxy' : proxyKey} is currently in use. Exiting to allow dashboard to switch accounts...`);
                        // Exit with 88 to signal Proxy Busy
                        process.exit(88);
                    }
                    else {
                        // For multi-account clumps, we just wait a bit and retry
                        this.logger.warn(false, 'MAIN', `Proxy ${proxyKey === 'NO_PROXY' ? 'No-Proxy' : proxyKey} is currently in use. Waiting...`);
                        await this.utils.wait(10000);
                        queue.unshift(account); // Try again later
                    }
                }
            }
        }
        if (this.config.clusters <= 1 && !cluster_1.default.isWorker) {
            const totalCollectedPoints = accountStats.reduce((sum, s) => sum + s.collectedPoints, 0);
            const totalInitialPoints = accountStats.reduce((sum, s) => sum + s.initialPoints, 0);
            const totalFinalPoints = accountStats.reduce((sum, s) => sum + s.finalPoints, 0);
            const totalDurationMinutes = ((Date.now() - runStartTime) / 1000 / 60).toFixed(1);
            this.logger.info('main', 'RUN-END', `Completed all accounts | Accounts processed: ${accountStats.length} | Total points collected: +${totalCollectedPoints} | Old total: ${totalInitialPoints} → New total: ${totalFinalPoints} | Total runtime: ${totalDurationMinutes}min`, 'green');
            await flushAllWebhooks();
        }
        return accountStats;
    }
    getProxyKey(account) {
        if (!account.proxy || !account.proxy.url) {
            return 'NO_PROXY';
        }
        // Normalize URL by stripping scheme prefix (http://, https://)
        // so that 'proxy.example.com' and 'http://proxy.example.com' are treated as the same proxy
        const normalizedUrl = account.proxy.url.replace(/^https?:\/\//i, '').toLowerCase().trim();
        return `${account.proxy.username || ''}@${normalizedUrl}:${account.proxy.port}`;
    }
    async acquireProxyLock(proxyKey) {
        const lockDir = node_path_1.default.join(process.cwd(), '.locks');
        try {
            if (!node_fs_1.default.existsSync(lockDir)) {
                node_fs_1.default.mkdirSync(lockDir, { recursive: true });
            }
        }
        catch (e) { }
        const safeKey = Buffer.from(proxyKey).toString('base64').replace(/[/+=]/g, '_');
        const lockPath = node_path_1.default.join(lockDir, `${safeKey}.lock`);
        try {
            // Try to create the lock file atomically
            node_fs_1.default.writeFileSync(lockPath, process.pid.toString(), { flag: 'wx' });
            return true;
        }
        catch (err) {
            if (err.code === 'EEXIST') {
                try {
                    const content = node_fs_1.default.readFileSync(lockPath, 'utf8').trim();
                    if (!content) {
                        node_fs_1.default.unlinkSync(lockPath);
                        return false;
                    }
                    const pid = parseInt(content);
                    if (isNaN(pid)) {
                        node_fs_1.default.unlinkSync(lockPath);
                        return false;
                    }
                    // Check if process is alive
                    try {
                        process.kill(pid, 0);
                        return pid === process.pid;
                    }
                    catch (e) {
                        // Dead process
                        node_fs_1.default.unlinkSync(lockPath);
                        return false;
                    }
                }
                catch (e) {
                    return false;
                }
            }
            return false;
        }
    }
    releaseProxyLock(proxyKey) {
        try {
            const safeKey = Buffer.from(proxyKey).toString('base64').replace(/[/+=]/g, '_');
            const lockPath = node_path_1.default.join(process.cwd(), '.locks', `${safeKey}.lock`);
            if (node_fs_1.default.existsSync(lockPath)) {
                const pid = parseInt(node_fs_1.default.readFileSync(lockPath, 'utf8').trim());
                if (pid === process.pid) {
                    node_fs_1.default.unlinkSync(lockPath);
                }
            }
        }
        catch (e) { }
    }
    async Main(account) {
        const accountEmail = account.email;
        this.logger.info('main', 'FLOW', `Starting session for ${accountEmail}`);
        let mobileSession = null;
        let mobileContextClosed = false;
        try {
            return await executionContext.run({ isMobile: true, account }, async () => {
                mobileSession = await this.browserFactory.createBrowser(account);
                const initialContext = mobileSession.context;
                this.mainMobilePage = await initialContext.newPage();
                this.logger.info('main', 'BROWSER', `Mobile Browser started | ${accountEmail}`);
                await this.login.login(this.mainMobilePage, account);
                try {
                    this.accessToken = await this.login.getAppAccessToken(this.mainMobilePage, accountEmail);
                }
                catch (error) {
                    this.logger.error('main', 'FLOW', `Failed to get mobile access token: ${error instanceof Error ? error.message : String(error)}`);
                }
                this.cookies.mobile = await initialContext.cookies();
                this.fingerprint = mobileSession.fingerprint;
                const data = await this.browser.func.getDashboardData();
                const appData = await this.browser.func.getAppDashboardData();
                // Set geo
                this.userData.geoLocale =
                    account.geoLocale === 'auto' ? data.userProfile.attributes.country : account.geoLocale.toLowerCase();
                this.userData.langCode =
                    account.langCode ? account.langCode.toLowerCase() : 'en';
                if (this.userData.geoLocale.length > 2) {
                    this.logger.warn('main', 'GEO-LOCALE', `The provided geoLocale is longer than 2 (${this.userData.geoLocale} | auto=${account.geoLocale === 'auto'}), this is likely invalid and can cause errors!`);
                }
                this.userData.initialPoints = data.userStatus.availablePoints;
                this.userData.currentPoints = data.userStatus.availablePoints;
                const initialPoints = this.userData.initialPoints ?? 0;
                const browserEarnable = await this.browser.func.getBrowserEarnablePoints();
                const appEarnable = await this.browser.func.getAppEarnablePoints();
                this.pointsCanCollect = browserEarnable.mobileSearchPoints + (appEarnable?.totalEarnablePoints ?? 0);
                this.logger.info('main', 'POINTS', `Earnable today | Mobile: ${this.pointsCanCollect} | Browser: ${browserEarnable.mobileSearchPoints} | App: ${appEarnable?.totalEarnablePoints ?? 0} | ${accountEmail} | locale: ${this.userData.geoLocale}`);
                if (this.config.workers.doAppPromotions)
                    await this.workers.doAppPromotions(appData);
                if (this.config.workers.doDailyCheckIn)
                    await this.activities.doDailyCheckIn();
                if (this.config.workers.doReadToEarn)
                    await this.activities.doReadToEarn();
                // Solve promotions in mobile context
                if (this.config.workers.doDailySet)
                    await this.workers.doDailySet(data, this.mainMobilePage);
                if (this.config.workers.doSpecialPromotions)
                    await this.workers.doSpecialPromotions(data);
                if (this.config.workers.doMorePromotions)
                    await this.workers.doMorePromotions(this.mainMobilePage);
                const searchPoints = await this.browser.func.getSearchPoints();
                const missingSearchPoints = this.browser.func.missingSearchPoints(searchPoints, true);
                this.cookies.mobile = await initialContext.cookies();
                const { mobilePoints, desktopPoints, rank: desktopRank } = await this.searchManager.doSearches(data, missingSearchPoints, mobileSession, account, accountEmail);
                mobileContextClosed = true;
                let rank = desktopRank;
                if (!rank) {
                    rank = this.browser.func.getAccountRank();
                }
                this.userData.gainedPoints = mobilePoints + desktopPoints;
                const finalPoints = await this.browser.func.getCurrentPoints();
                const collectedPoints = finalPoints - initialPoints;
                this.logger.info('main', 'FLOW', `Collected: +${collectedPoints} | Mobile: +${mobilePoints} | Desktop: +${desktopPoints} | Rank: ${rank || 'N/A'} | ${accountEmail}`);
                return {
                    initialPoints,
                    collectedPoints: collectedPoints || 0,
                    rank: rank || ''
                };
            });
        }
        finally {
            if (mobileSession && !mobileContextClosed) {
                try {
                    await executionContext.run({ isMobile: true, account }, async () => {
                        await this.browser.func.closeBrowser(mobileSession.context, accountEmail);
                    });
                }
                catch { }
            }
        }
    }
}
exports.MicrosoftRewardsBot = MicrosoftRewardsBot;
async function main() {
    // Check before doing anything
    (0, Validator_1.checkNodeVersion)();
    const rewardsBot = new MicrosoftRewardsBot();
    process.on('beforeExit', () => {
        void flushAllWebhooks();
    });
    process.on('SIGINT', async () => {
        rewardsBot.logger.warn('main', 'PROCESS', 'SIGINT received, flushing and exiting...');
        await flushAllWebhooks();
        process.exit(130);
    });
    process.on('SIGTERM', async () => {
        rewardsBot.logger.warn('main', 'PROCESS', 'SIGTERM received, flushing and exiting...');
        await flushAllWebhooks();
        process.exit(143);
    });
    process.on('uncaughtException', async (error) => {
        rewardsBot.logger.error('main', 'UNCAUGHT-EXCEPTION', error);
        await flushAllWebhooks();
        process.exit(1);
    });
    process.on('unhandledRejection', async (reason) => {
        rewardsBot.logger.error('main', 'UNHANDLED-REJECTION', reason);
        await flushAllWebhooks();
        process.exit(1);
    });
    try {
        await rewardsBot.initialize();
        await rewardsBot.run();
    }
    catch (error) {
        rewardsBot.logger.error('main', 'MAIN-ERROR', error);
    }
}
main().catch(async (error) => {
    const tmpBot = new MicrosoftRewardsBot();
    tmpBot.logger.error('main', 'MAIN-ERROR', error);
    await flushAllWebhooks();
    process.exit(1);
});
//# sourceMappingURL=index.js.map