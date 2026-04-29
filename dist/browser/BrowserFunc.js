import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { saveSessionData } from '../util/Load.js';
/**
 * Lỗi đặc biệt khi session bị xóa do 400/401 — dùng để trigger retry trong runTasks
 */
export class SessionInvalidError extends Error {
    sessionCleared = true;
    constructor(status) {
        super(`Session invalid (HTTP ${status}) — session cleared, re-login required`);
        this.name = 'SessionInvalidError';
    }
}
export default class BrowserFunc {
    bot;
    accountRank = '';
    constructor(bot) {
        this.bot = bot;
    }
    /**
     * Fetch user desktop dashboard data
     * @returns {DashboardData} Object of user bing rewards dashboard data
     */
    async getDashboardData() {
        try {
            // API requires X-Requested-With in both URL and header
            // Try desktop cookies first (web API might need desktop session)
            const cookiesToUse = this.bot.cookies.desktop?.length > 0 ? this.bot.cookies.desktop : this.bot.cookies.mobile;
            const timestamp = Date.now();
            const request = {
                url: `https://rewards.bing.com/api/getuserinfo?type=1&X-Requested-With=XMLHttpRequest&_=${timestamp}`,
                method: 'GET',
                headers: {
                    ...(this.bot.fingerprint?.headers ?? {}),
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Connection': 'keep-alive',
                    'User-Agent': this.bot.fingerprint?.headers?.['User-Agent'] ||
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
                    Cookie: this.buildCookieHeader(cookiesToUse, [
                        'bing.com',
                        'live.com',
                        'microsoftonline.com',
                        'microsoft.com',
                        'msn.com'
                    ]),
                    Referer: 'https://rewards.bing.com/',
                    Origin: 'https://rewards.bing.com'
                },
                timeout: 15000
            };
            this.bot.logger.debug(this.bot.isMobile, 'GET-DASHBOARD-DATA', `Sending ${cookiesToUse.length} cookies (desktop: ${this.bot.cookies.desktop?.length || 0}, mobile: ${this.bot.cookies.mobile?.length || 0})`);
            const response = await this.bot.axios.request(request);
            if (response.data?.dashboard) {
                this.accountRank = response.data.dashboard.userStatus?.levelInfo?.activeLevelName || '';
                return response.data.dashboard;
            }
            throw new Error('Dashboard data missing from API response');
        }
        catch (error) {
            // Microsoft changed to Next.js - HTML no longer contains var dashboard
            // The API is now the only reliable method
            const errorMsg = error instanceof Error ? error.message : String(error);
            const status = error?.response?.status;
            const responseData = error?.response?.data;
            this.bot.logger.error(this.bot.isMobile, 'GET-DASHBOARD-DATA', `Failed to get dashboard data: ${errorMsg} (Status: ${status || 'unknown'})`);
            // Log response data for debugging auth errors
            if ((status === 401 || status === 400) && responseData) {
                this.bot.logger.debug(this.bot.isMobile, 'GET-DASHBOARD-DATA', `${status} Response: ${JSON.stringify(responseData).substring(0, 500)}`);
            }
            // If 400 or 401, session is invalid → clear to force re-login next run
            if (status === 401 || status === 400) {
                this.bot.logger.warn(this.bot.isMobile, 'GET-DASHBOARD-DATA', `Session invalid (${status}), clearing session files to force re-login on next run`);
                await this.clearSessionFiles();
                // Throw special error so runTasks can auto-retry this account
                throw new SessionInvalidError(status);
            }
            throw new Error(`Dashboard API failed: ${errorMsg}`);
        }
    }
    getAccountRank() {
        return this.accountRank;
    }
    buildCookieHeader(cookies, domainFilter) {
        return cookies
            .filter(c => !domainFilter || domainFilter.some(d => c.domain?.includes(d)))
            .map(c => `${c.name}=${c.value}`)
            .join('; ');
    }
    /**
     * Clear session files to force re-login
     * Path must match Load.ts: path.join(__dirname, '../browser/', sessionPath, email)
     */
    async clearSessionFiles() {
        try {
            const sessionPath = this.bot.config.sessionPath;
            const email = this.bot.email;
            if (!email) {
                this.bot.logger.warn(this.bot.isMobile, 'SESSION', 'Cannot clear session: email is empty');
                return;
            }
            // Resolve path the same way as Load.ts saveSessionData()
            const sessionDir = path.join(__dirname, '../browser/', sessionPath, email);
            const mobileSession = path.join(sessionDir, 'session_mobile.json');
            const desktopSession = path.join(sessionDir, 'session_desktop.json');
            let deleted = 0;
            if (fs.existsSync(mobileSession)) {
                fs.unlinkSync(mobileSession);
                deleted++;
                this.bot.logger.info(this.bot.isMobile, 'SESSION', `Deleted mobile session: ${mobileSession}`);
            }
            if (fs.existsSync(desktopSession)) {
                fs.unlinkSync(desktopSession);
                deleted++;
                this.bot.logger.info(this.bot.isMobile, 'SESSION', `Deleted desktop session: ${desktopSession}`);
            }
            if (deleted === 0) {
                this.bot.logger.warn(this.bot.isMobile, 'SESSION', `No session files found at: ${sessionDir}`);
            }
            else {
                this.bot.logger.info(this.bot.isMobile, 'SESSION', `Cleared ${deleted} session file(s) for ${email} — will re-login next run`);
            }
            // Clear in-memory cookies
            this.bot.cookies.mobile = [];
            this.bot.cookies.desktop = [];
            // Also clear browser context cookies if page is available
            try {
                if (this.bot.mainMobilePage && !this.bot.mainMobilePage.isClosed()) {
                    await this.bot.mainMobilePage.context().clearCookies();
                    this.bot.logger.info(this.bot.isMobile, 'SESSION', 'Cleared browser context cookies');
                }
            }
            catch (e) {
                this.bot.logger.debug(this.bot.isMobile, 'SESSION', `Could not clear browser context cookies: ${e}`);
            }
        }
        catch (err) {
            this.bot.logger.error(this.bot.isMobile, 'SESSION', `Failed to clear session: ${err}`);
        }
    }
    /**
     * Fetch user app dashboard data
     * @returns {AppDashboardData} Object of user bing rewards dashboard data
     */
    async getAppDashboardData() {
        try {
            const request = {
                url: 'https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAIOS&options=613',
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.bot.accessToken}`,
                    'User-Agent': 'Bing/32.5.431027001 (com.microsoft.bing; build:431027001; iOS 17.6.1) Alamofire/5.10.2'
                }
            };
            const response = await this.bot.axios.request(request);
            return response.data;
        }
        catch (error) {
            this.bot.logger.info(this.bot.isMobile, 'GET-APP-DASHBOARD-DATA', `Error fetching dashboard data: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    /**
     * Fetch user xbox dashboard data
     * @returns {XboxDashboardData} Object of user bing rewards dashboard data
     */
    async getXBoxDashboardData() {
        try {
            const request = {
                url: 'https://prod.rewardsplatform.microsoft.com/dapi/me?channel=xboxapp&options=6',
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.bot.accessToken}`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox One X) AppleWebKit/537.36 (KHTML, like Gecko) Edge/18.19041'
                }
            };
            const response = await this.bot.axios.request(request);
            return response.data;
        }
        catch (error) {
            this.bot.logger.info(this.bot.isMobile, 'GET-XBOX-DASHBOARD-DATA', `Error fetching dashboard data: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    /**
     * Get search point counters
     */
    async getSearchPoints() {
        const dashboardData = await this.getDashboardData(); // Always fetch newest data
        return dashboardData.userStatus.counters;
    }
    missingSearchPoints(counters, isMobile) {
        const mobileData = counters.mobileSearch?.[0];
        const desktopData = counters.pcSearch?.[0];
        const edgeData = counters.pcSearch?.[1];
        const mobilePoints = mobileData ? Math.max(0, mobileData.pointProgressMax - mobileData.pointProgress) : 0;
        const desktopPoints = desktopData ? Math.max(0, desktopData.pointProgressMax - desktopData.pointProgress) : 0;
        const edgePoints = edgeData ? Math.max(0, edgeData.pointProgressMax - edgeData.pointProgress) : 0;
        const totalPoints = isMobile ? mobilePoints : desktopPoints + edgePoints;
        return { mobilePoints, desktopPoints, edgePoints, totalPoints };
    }
    /**
     * Get total earnable points with web browser
     */
    async getBrowserEarnablePoints() {
        try {
            const data = await this.getDashboardData();
            const desktopSearchPoints = data.userStatus.counters.pcSearch?.reduce((sum, x) => sum + (x.pointProgressMax - x.pointProgress), 0) ?? 0;
            const mobileSearchPoints = data.userStatus.counters.mobileSearch?.reduce((sum, x) => sum + (x.pointProgressMax - x.pointProgress), 0) ?? 0;
            const todayDate = this.bot.utils.getFormattedDate();
            const dailySetPoints = data.dailySetPromotions[todayDate]?.reduce((sum, x) => sum + (x.pointProgressMax - x.pointProgress), 0) ?? 0;
            const morePromotionsPoints = data.morePromotions?.reduce((sum, x) => {
                if (['quiz', 'urlreward'].includes(x.promotionType) &&
                    x.exclusiveLockedFeatureStatus !== 'locked') {
                    return sum + (x.pointProgressMax - x.pointProgress);
                }
                return sum;
            }, 0) ?? 0;
            const totalEarnablePoints = desktopSearchPoints + mobileSearchPoints + dailySetPoints + morePromotionsPoints;
            return {
                dailySetPoints,
                morePromotionsPoints,
                desktopSearchPoints,
                mobileSearchPoints,
                totalEarnablePoints
            };
        }
        catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'GET-BROWSER-EARNABLE-POINTS', `An error occurred: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    /**
     * Get total earnable points with mobile app
     */
    async getAppEarnablePoints() {
        try {
            const request = {
                url: 'https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613',
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.bot.accessToken}`,
                    'X-Rewards-Country': this.bot.userData.geoLocale,
                    'X-Rewards-Language': 'en',
                    'X-Rewards-ismobile': 'true'
                }
            };
            const response = await this.bot.axios.request(request);
            const userData = response.data;
            const eligibleActivities = userData.response.promotions.filter(x => x.attributes.type === 'msnreadearn' || x.attributes.type === 'checkin');
            let readToEarn = 0;
            let checkIn = 0;
            for (const item of eligibleActivities) {
                const attrs = item.attributes;
                if (attrs.type === 'msnreadearn') {
                    const pointMax = parseInt(attrs.pointmax ?? '0');
                    const pointProgress = parseInt(attrs.pointprogress ?? '0');
                    readToEarn = Math.max(0, pointMax - pointProgress);
                }
                else if (attrs.type === 'checkin') {
                    const progress = parseInt(attrs.progress ?? '0');
                    const checkInDay = progress % 7;
                    const lastUpdated = new Date(attrs.last_updated ?? '');
                    const today = new Date();
                    if (checkInDay < 6 && today.getDate() !== lastUpdated.getDate()) {
                        checkIn = parseInt(attrs[`day_${checkInDay + 1}_points`] ?? '0');
                    }
                }
            }
            const totalEarnablePoints = readToEarn + checkIn;
            return {
                readToEarn,
                checkIn,
                totalEarnablePoints
            };
        }
        catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'GET-APP-EARNABLE-POINTS', `An error occurred: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    /**
     * Get current point amount
     * @returns {number} Current total point amount
     */
    async getCurrentPoints() {
        try {
            const data = await this.getDashboardData();
            return data.userStatus.availablePoints;
        }
        catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'GET-CURRENT-POINTS', `An error occurred: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    async closeBrowser(browser, email) {
        try {
            const cookies = await browser.cookies();
            // Save cookies
            this.bot.logger.debug(this.bot.isMobile, 'CLOSE-BROWSER', `Saving ${cookies.length} cookies to session folder!`);
            await saveSessionData(this.bot.config.sessionPath, cookies, email, this.bot.isMobile);
            await this.bot.utils.wait(2000);
            // Close browser
            await browser.close();
            this.bot.logger.info(this.bot.isMobile, 'CLOSE-BROWSER', 'Browser closed cleanly!');
        }
        catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'CLOSE-BROWSER', `An error occurred: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    mergeCookies(response, currentCookieHeader = '', whitelist) {
        const cookieMap = new Map(currentCookieHeader
            .split(';')
            .map(pair => pair.split('=').map(s => s.trim()))
            .filter(([name, value]) => name && value)
            .map(([name, value]) => [name, value]));
        const setCookieList = [response.headers['set-cookie']].flat().filter(Boolean);
        const cookiesByName = new Map(this.bot.cookies.mobile.map(c => [c.name, c]));
        for (const setCookie of setCookieList) {
            const [nameValue, ...attributes] = setCookie.split(';').map(s => s.trim());
            if (!nameValue)
                continue;
            const [name, value] = nameValue.split('=').map(s => s.trim());
            if (!name)
                continue;
            if (whitelist && !whitelist?.includes(name)) {
                continue;
            }
            const attrs = this.parseAttributes(attributes);
            const existing = cookiesByName.get(name);
            if (!value) {
                if (existing) {
                    cookiesByName.delete(name);
                    this.bot.cookies.mobile = this.bot.cookies.mobile.filter(c => c.name !== name);
                }
                cookieMap.delete(name);
                continue;
            }
            if (attrs.expires !== undefined && attrs.expires < Date.now() / 1000) {
                if (existing) {
                    cookiesByName.delete(name);
                    this.bot.cookies.mobile = this.bot.cookies.mobile.filter(c => c.name !== name);
                }
                cookieMap.delete(name);
                continue;
            }
            cookieMap.set(name, value);
            if (existing) {
                this.updateCookie(existing, value, attrs);
            }
            else {
                this.bot.cookies.mobile.push(this.createCookie(name, value, attrs));
            }
        }
        return Array.from(cookieMap, ([name, value]) => `${name}=${value}`).join('; ');
    }
    parseAttributes(attributes) {
        const attrs = {};
        for (const attr of attributes) {
            const [key, val] = attr.split('=').map(s => s?.trim());
            const lowerKey = key?.toLowerCase();
            switch (lowerKey) {
                case 'domain':
                case 'path': {
                    if (val)
                        attrs[lowerKey] = val;
                    break;
                }
                case 'expires': {
                    if (val) {
                        const ts = Date.parse(val);
                        if (!isNaN(ts))
                            attrs.expires = Math.floor(ts / 1000);
                    }
                    break;
                }
                case 'max-age': {
                    if (val) {
                        const maxAge = Number(val);
                        if (!isNaN(maxAge))
                            attrs.expires = Math.floor(Date.now() / 1000) + maxAge;
                    }
                    break;
                }
                case 'httponly': {
                    attrs.httpOnly = true;
                    break;
                }
                case 'secure': {
                    attrs.secure = true;
                    break;
                }
                case 'samesite': {
                    const normalized = val?.toLowerCase();
                    if (normalized && ['lax', 'strict', 'none'].includes(normalized)) {
                        attrs.sameSite = (normalized.charAt(0).toUpperCase() +
                            normalized.slice(1));
                    }
                    break;
                }
            }
        }
        return attrs;
    }
    updateCookie(cookie, value, attrs) {
        cookie.value = value;
        if (attrs.domain)
            cookie.domain = attrs.domain;
        if (attrs.path)
            cookie.path = attrs.path;
        //if (attrs.expires !== undefined) cookie.expires = attrs.expires
        //if (attrs.httpOnly) cookie.httpOnly = true
        //if (attrs.secure) cookie.secure = true
        //if (attrs.sameSite) cookie.sameSite = attrs.sameSite
    }
    createCookie(name, value, attrs) {
        return {
            name,
            value,
            domain: attrs.domain || '.bing.com',
            path: attrs.path || '/'
            /*
            ...(attrs.expires !== undefined && { expires: attrs.expires }),
            ...(attrs.httpOnly && { httpOnly: true }),
            ...(attrs.secure && { secure: true }),
            ...(attrs.sameSite && { sameSite: attrs.sameSite })
            */
        };
    }
}
//# sourceMappingURL=BrowserFunc.js.map