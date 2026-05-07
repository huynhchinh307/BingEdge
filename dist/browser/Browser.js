import patchright from 'patchright';
import { newInjectedContext } from 'fingerprint-injector';
import { FingerprintGenerator } from 'fingerprint-generator';
import fs from 'fs';
import path from 'path';
import { Server as ProxyChainServer } from 'proxy-chain';
import { loadSessionData, saveFingerprintData } from '../util/Load.js';
import { UserAgentManager } from './UserAgent.js';
import AxiosClient from '../util/Axios.js';
class Browser {
    bot;
    static BROWSER_ARGS = [
        '--no-sandbox',
        '--mute-audio',
        '--disable-setuid-sandbox',
        '--ignore-certificate-errors',
        '--ignore-certificate-errors-spki-list',
        '--ignore-ssl-errors',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-web-authentication-ui',
        '--disable-external-intent-requests',
        '--disable-blink-features=Attestation',
        '--disable-features=WebAuthentication,PasswordManagerOnboarding,PasswordManager,EnablePasswordsAccountStorage,Passkeys,WebAuthenticationProxy,U2F',
        '--disable-save-password-bubble',
        '--window-size=1920,1080'
    ];
    constructor(bot) {
        this.bot = bot;
    }
    async createBrowser(account) {
        let browser;
        let chainServer = null;
        // Determine effective proxy (Account proxy takes precedence, then Global fallback)
        const globalProxy = this.bot.config.proxy;
        const effectiveProxy = account.proxy.url
            ? account.proxy
            : (globalProxy && globalProxy.enable && globalProxy.url ? {
                url: globalProxy.url,
                port: Number(globalProxy.port) || 0,
                username: globalProxy.username || undefined,
                password: globalProxy.password || undefined,
                proxyAxios: true
            } : null);
        try {
            let bypassString = undefined;
            const bypassFilePath = path.join(process.cwd(), 'bypass.txt');
            if (fs.existsSync(bypassFilePath)) {
                try {
                    const bypassContent = fs.readFileSync(bypassFilePath, 'utf8').trim();
                    if (bypassContent) {
                        bypassString = bypassContent;
                    }
                }
                catch (e) {
                    this.bot.logger.warn(this.bot.isMobile, 'BROWSER', `Failed to read bypass.txt: ${e.message}`);
                }
            }
            const bypassPatterns = bypassString ? this.compileBypassPatterns(bypassString) : [];
            const hasV4Fallback = !!(account.proxy.url &&
                account.proxy.v4 &&
                account.proxy.v4.url &&
                account.proxy.v4.port &&
                bypassPatterns.length > 0);
            let proxyConfig;
            if (hasV4Fallback) {
                // Spin up a local proxy-chain router that selects upstream per host.
                // Browser sees only the local proxy (no auth), proxy-chain handles
                // upstream auth for both V6 (default) and V4 (bypass-matched hosts).
                const v6Upstream = this.toUpstreamUrl({
                    url: account.proxy.url,
                    port: account.proxy.port,
                    username: account.proxy.username,
                    password: account.proxy.password
                });
                const v4Upstream = this.toUpstreamUrl(account.proxy.v4);
                chainServer = new ProxyChainServer({
                    port: 0,
                    prepareRequestFunction: ({ hostname }) => {
                        const useV4 = bypassPatterns.some(re => re.test(hostname));
                        return { upstreamProxyUrl: useV4 ? v4Upstream : v6Upstream };
                    }
                });
                await chainServer.listen();
                const localPort = chainServer.port;
                proxyConfig = { server: `http://127.0.0.1:${localPort}` };
                this.bot.logger.info(this.bot.isMobile, 'BROWSER', `Proxy router on 127.0.0.1:${localPort} | V6 default + V4 fallback for ${bypassPatterns.length} bypass pattern(s)`);
            }
            else if (effectiveProxy && effectiveProxy.url) {
                proxyConfig = {
                    server: this.formatProxyServer(effectiveProxy),
                    bypass: bypassString,
                    ...(effectiveProxy.username &&
                        effectiveProxy.password && {
                        username: effectiveProxy.username,
                        password: effectiveProxy.password
                    })
                };
                if (!account.proxy.url && globalProxy.enable) {
                    this.bot.logger.info(this.bot.isMobile, 'BROWSER', `Using global fallback proxy: ${effectiveProxy.url}:${effectiveProxy.port}`);
                }
            }
            this.bot.logger.info(this.bot.isMobile, 'BROWSER', `Launching stealth browser (Patchright)`);
            browser = await patchright.chromium.launch({
                headless: this.bot.config.headless,
                ...(proxyConfig && { proxy: proxyConfig }),
                args: [...Browser.BROWSER_ARGS]
            });
            // Cleanup local proxy server when browser closes
            if (chainServer) {
                const srv = chainServer;
                browser.on('disconnected', () => {
                    srv.close(true).catch(() => { });
                });
            }
        }
        catch (error) {
            // Make sure to release the local proxy server if launch failed
            if (chainServer) {
                chainServer.close(true).catch(() => { });
            }
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.logger.error(this.bot.isMobile, 'BROWSER', `Launch failed: ${errorMessage}`);
            throw error;
        }
        try {
            const sessionData = await loadSessionData(this.bot.config.sessionPath, account.email, account.saveFingerprint, this.bot.isMobile);
            const fingerprint = sessionData.fingerprint ?? (await this.generateFingerprint(this.bot.isMobile));
            const locale = account.geoLocale === 'auto' ? 'en-US' : `${account.geoLocale.toLowerCase()}-${account.geoLocale.toUpperCase()}`;
            this.bot.logger.info(this.bot.isMobile, 'BROWSER', `Syncing location and timezone with IP...`);
            await this.checkAndRotateLocalProxy(effectiveProxy);
            const ipLocation = await this.getIpLocation(effectiveProxy || {});
            const context = await newInjectedContext(browser, {
                fingerprint,
                newContextOptions: {
                    locale,
                    timezoneId: ipLocation?.timezone,
                    geolocation: ipLocation ? { latitude: ipLocation.lat, longitude: ipLocation.lon } : undefined,
                    bypassCSP: true,
                    ignoreHTTPSErrors: true,
                    permissions: ['geolocation']
                }
            });
            await context.addInitScript((locationData) => {
                // Mock Geolocation
                if (locationData) {
                    const { latitude, longitude } = locationData;
                    navigator.geolocation.getCurrentPosition = (success) => {
                        success({
                            coords: {
                                latitude,
                                longitude,
                                accuracy: 100,
                                altitude: null,
                                altitudeAccuracy: null,
                                heading: null,
                                speed: null,
                            },
                            timestamp: Date.now(),
                        });
                    };
                    navigator.geolocation.watchPosition = (success) => {
                        success({
                            coords: {
                                latitude,
                                longitude,
                                accuracy: 100,
                                altitude: null,
                                altitudeAccuracy: null,
                                heading: null,
                                speed: null,
                            },
                            timestamp: Date.now(),
                        });
                        return 1337; // Dummy ID
                    };
                }
                // Disable Credentials
                Object.defineProperty(navigator, 'credentials', {
                    value: {
                        create: () => Promise.reject(new Error('WebAuthn disabled')),
                        get: () => Promise.reject(new Error('WebAuthn disabled'))
                    }
                });
            }, ipLocation ? { latitude: ipLocation.lat, longitude: ipLocation.lon } : null);
            // Grant permissions explicitly for common domains
            await context.grantPermissions(['geolocation'], { origin: 'https://rewards.bing.com' });
            await context.grantPermissions(['geolocation'], { origin: 'https://www.bing.com' });
            await context.grantPermissions(['geolocation'], { origin: 'https://microsoft.com' });
            context.setDefaultTimeout(this.bot.utils.stringToNumber(this.bot.config?.globalTimeout ?? 30000));
            await context.addCookies(sessionData.cookies);
            if ((account.saveFingerprint.mobile && this.bot.isMobile) ||
                (account.saveFingerprint.desktop && !this.bot.isMobile)) {
                await saveFingerprintData(this.bot.config.sessionPath, account.email, this.bot.isMobile, fingerprint);
            }
            this.bot.logger.info(this.bot.isMobile, 'BROWSER', `Created browser with User-Agent: "${fingerprint.fingerprint.navigator.userAgent}"`);
            this.bot.logger.debug(this.bot.isMobile, 'BROWSER-FINGERPRINT', JSON.stringify(fingerprint));
            return { browser, context: context, fingerprint };
        }
        catch (error) {
            await browser.close().catch(() => { });
            throw error;
        }
    }
    formatProxyServer(proxy) {
        try {
            const urlObj = new URL(proxy.url);
            const protocol = urlObj.protocol.replace(':', '');
            return `${protocol}://${urlObj.hostname}:${proxy.port}`;
        }
        catch {
            return `${proxy.url}:${proxy.port}`;
        }
    }
    /**
     * Convert a comma-separated bypass pattern list (e.g. `*.live.com, microsoft.com`)
     * into anchored case-insensitive RegExp objects matching hostnames.
     */
    compileBypassPatterns(bypass) {
        return bypass
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .map(pat => {
            const escaped = pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
            return new RegExp(`^${escaped}$`, 'i');
        });
    }
    /**
     * Build a fully-qualified upstream proxy URL (with embedded credentials)
     * suitable for passing to proxy-chain's `upstreamProxyUrl`.
     */
    toUpstreamUrl(p) {
        let proto = 'http';
        let host = p.url;
        try {
            const u = new URL(p.url.includes('://') ? p.url : `http://${p.url}`);
            proto = (u.protocol || 'http:').replace(':', '') || 'http';
            host = u.hostname || host;
        }
        catch {
            host = p.url.replace(/^(https?|socks[45]):\/\//i, '');
        }
        const auth = p.username && p.password
            ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password)}@`
            : '';
        return `${proto}://${auth}${host}:${p.port}`;
    }
    detectIpVersion(ip) {
        if (!ip)
            return 'unknown';
        // IPv4: xxx.xxx.xxx.xxx
        if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip))
            return 'v4';
        // IPv6: contains colons
        if (/^([0-9a-fA-F:]+)$/.test(ip) && ip.includes(':'))
            return 'v6';
        return 'unknown';
    }
    async getIpLocation(proxy) {
        // Nếu không có proxy → bỏ qua IP sync, trả về null ngay
        if (!proxy?.url) {
            this.bot.logger.info(this.bot.isMobile, 'BROWSER-IP-LOC', 'No proxy configured, skipping IP location sync (using machine IP)');
            return null;
        }
        // Force proxy usage for this check to get the location of the proxy IP
        const axios = new AxiosClient({ ...proxy, proxyAxios: true });
        // Detect if proxy is IPv4 or IPv6 from url
        let proxyHost = '';
        try {
            const urlObj = new URL(proxy.url);
            proxyHost = urlObj.hostname;
        }
        catch {
            proxyHost = proxy.url.replace(/^(https?|socks[45]):\/\//i, '').split(':')[0] || '';
        }
        const ipVersion = this.detectIpVersion(proxyHost);
        this.bot.logger.debug(this.bot.isMobile, 'BROWSER-IP-LOC', `Proxy IP version detected: ${ipVersion} (${proxyHost})`);
        // Try multiple IP geolocation APIs in parallel for speed
        // Using HTTP for ip-api (faster, works with all proxies)
        // Using HTTPS for ipapi (more reliable)
        const ipServices = [
            { name: 'ip-api', url: 'http://ip-api.com/json/?fields=status,lat,lon,timezone,country,city,query', timeout: 4000 },
            { name: 'ipapi', url: 'https://ipapi.co/json/', timeout: 4000 },
        ];
        const requests = ipServices.map(async (service) => {
            try {
                const response = await axios.request({
                    url: service.url,
                    method: 'GET',
                    timeout: service.timeout
                });
                return { service: service.name, data: response.data };
            }
            catch (err) {
                return { service: service.name, error: err.message };
            }
        });
        // Race to get first successful response
        const results = await Promise.allSettled(requests);
        for (const result of results) {
            if (result.status === 'fulfilled' && !result.value.error) {
                const { service, data } = result.value;
                // Parse different API response formats
                let location = null;
                if (service === 'ip-api' && data.status === 'success') {
                    location = {
                        lat: data.lat,
                        lon: data.lon,
                        timezone: data.timezone
                    };
                }
                else if (service === 'ipapi' && data.latitude) {
                    location = {
                        lat: data.latitude,
                        lon: data.longitude,
                        timezone: data.timezone
                    };
                }
                if (location) {
                    this.bot.logger.debug(this.bot.isMobile, 'BROWSER-IP-LOC', `Detected via ${service}: ${location.lat}, ${location.lon} | ${location.timezone}`);
                    return location;
                }
            }
        }
        // Log which services failed
        const failed = results
            .filter((r) => r.status === 'fulfilled')
            .filter(r => r.value.error)
            .map(r => `${r.value.service}: ${r.value.error}`)
            .join(', ');
        this.bot.logger.warn(this.bot.isMobile, 'BROWSER-IP-LOC', `All IP location services failed${failed ? ' - ' + failed : ''}`);
        return null;
    }
    async generateFingerprint(isMobile) {
        const browserType = this.bot.config.browserType ?? 'chromium';
        const fingerprintBrowser = browserType === 'edge' ? 'edge' : 'chrome';
        const fingerPrintData = new FingerprintGenerator().getFingerprint({
            devices: isMobile ? ['mobile'] : ['desktop'],
            operatingSystems: isMobile ? ['android', 'ios'] : ['windows', 'macos', 'linux'],
            browsers: [fingerprintBrowser],
            ...(isMobile ? {} : {
                screen: {
                    minWidth: 1920,
                    maxWidth: 1920,
                    minHeight: 1080,
                    maxHeight: 1080
                }
            })
        });
        const userAgentManager = new UserAgentManager(this.bot);
        const updatedFingerPrintData = await userAgentManager.updateFingerprintUserAgent(fingerPrintData, isMobile);
        return updatedFingerPrintData;
    }
    async checkAndRotateLocalProxy(proxy) {
        if (!proxy || !proxy.url)
            return;
        const isLocal = proxy.url.includes('127.0.0.1') || proxy.url.includes('localhost');
        const isV6 = proxy.isProxyV6;
        if (isLocal && isV6) {
            this.bot.logger.info(this.bot.isMobile, 'BROWSER', `Detected local IPv6 proxy: ${proxy.url}:${proxy.port}. Ensuring it is alive...`);
            let axios = null;
            try {
                const axiosMod = await import('axios');
                axios = axiosMod.default;
            }
            catch {
                return; // fallback
            }
            const { HttpsProxyAgent } = await import('https-proxy-agent');
            const { SocksProxyAgent } = await import('socks-proxy-agent');
            const serverUrl = proxy.url.includes('://') ? proxy.url : `http://${proxy.url}`;
            const urlObj = new URL(serverUrl);
            const port = proxy.port;
            let proxyUrl = `${urlObj.protocol}//`;
            if (proxy.username && proxy.password) {
                proxyUrl += `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`;
            }
            proxyUrl += `${urlObj.hostname}:${port}`;
            let agent = null;
            if (urlObj.protocol === 'socks4:' || urlObj.protocol === 'socks5:') {
                agent = new SocksProxyAgent(proxyUrl);
            }
            else {
                agent = new HttpsProxyAgent(proxyUrl);
            }
            const checkAlive = async () => {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);
                try {
                    const resp = await axios.get('https://www.google.com/generate_204', {
                        httpsAgent: agent,
                        signal: controller.signal
                    });
                    clearTimeout(timeoutId);
                    return resp.status < 400;
                }
                catch {
                    clearTimeout(timeoutId);
                    return false;
                }
            };
            this.bot.logger.info(this.bot.isMobile, 'BROWSER', 'Checking if proxy is alive...');
            let isAlive = await checkAlive();
            let attempts = 0;
            while (!isAlive && attempts < 10) {
                attempts++;
                this.bot.logger.warn(this.bot.isMobile, 'BROWSER', `Proxy is dead or timed out. Rotating via local API... (Attempt ${attempts}/10)`);
                try {
                    const response = await axios.post(`http://localhost:9002/proxy/rotate/${port}`, {}, { timeout: 15000 });
                    this.bot.logger.info(this.bot.isMobile, 'BROWSER', `Rotate API response: ${JSON.stringify(response.data)}`);
                    await new Promise(r => setTimeout(r, 3000));
                }
                catch (err) {
                    this.bot.logger.warn(this.bot.isMobile, 'BROWSER', `Failed to call rotate API: ${err.message}`);
                    await new Promise(r => setTimeout(r, 5000));
                }
                isAlive = await checkAlive();
            }
            if (!isAlive) {
                this.bot.logger.error(this.bot.isMobile, 'BROWSER', `Failed to rotate local proxy after 10 attempts. Exiting...`);
                process.exit(88); // 88 = proxy busy/dead
            }
        }
    }
}
export default Browser;
//# sourceMappingURL=Browser.js.map