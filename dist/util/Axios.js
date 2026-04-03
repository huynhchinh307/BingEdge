"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const axios_retry_1 = __importDefault(require("axios-retry"));
const http_proxy_agent_1 = require("http-proxy-agent");
const https_proxy_agent_1 = require("https-proxy-agent");
const socks_proxy_agent_1 = require("socks-proxy-agent");
const url_1 = require("url");
class AxiosClient {
    constructor(account) {
        this.account = account;
        this.instance = axios_1.default.create({
            timeout: 20000
        });
        if (this.account.url && this.account.proxyAxios) {
            const agent = this.getAgentForProxy(this.account);
            this.instance.defaults.httpAgent = agent;
            this.instance.defaults.httpsAgent = agent;
        }
        (0, axios_retry_1.default)(this.instance, {
            retries: 5,
            retryDelay: axios_retry_1.default.exponentialDelay,
            shouldResetTimeout: true,
            retryCondition: error => {
                if (axios_retry_1.default.isNetworkError(error))
                    return true;
                if (!error.response)
                    return true;
                const status = error.response.status;
                return status === 429 || (status >= 500 && status <= 599);
            }
        });
    }
    getAgentForProxy(proxyConfig) {
        const { url: baseUrl, port, username, password } = proxyConfig;
        let urlObj;
        try {
            urlObj = new url_1.URL(baseUrl);
        }
        catch (e) {
            try {
                urlObj = new url_1.URL(`http://${baseUrl}`);
            }
            catch (error) {
                throw new Error(`Invalid proxy URL format: ${baseUrl}`);
            }
        }
        const protocol = urlObj.protocol.toLowerCase();
        let proxyUrl;
        if (username && password) {
            urlObj.username = encodeURIComponent(username);
            urlObj.password = encodeURIComponent(password);
            urlObj.port = port.toString();
            proxyUrl = urlObj.toString();
        }
        else {
            proxyUrl = `${protocol}//${urlObj.hostname}:${port}`;
        }
        switch (protocol) {
            case 'http:':
                return new http_proxy_agent_1.HttpProxyAgent(proxyUrl);
            case 'https:':
                return new https_proxy_agent_1.HttpsProxyAgent(proxyUrl);
            case 'socks4:':
            case 'socks5:':
                return new socks_proxy_agent_1.SocksProxyAgent(proxyUrl);
            default:
                throw new Error(`Unsupported proxy protocol: ${protocol}. Only HTTP(S) and SOCKS4/5 are supported!`);
        }
    }
    async request(config, bypassProxy = false) {
        if (bypassProxy) {
            const bypassInstance = axios_1.default.create();
            (0, axios_retry_1.default)(bypassInstance, {
                retries: 3,
                retryDelay: axios_retry_1.default.exponentialDelay
            });
            return bypassInstance.request(config);
        }
        return this.instance.request(config);
    }
}
exports.default = AxiosClient;
//# sourceMappingURL=Axios.js.map