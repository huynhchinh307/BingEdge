export interface Account {
    email: string;
    password: string;
    totpSecret?: string;
    recoveryEmail: string;
    geoLocale: 'auto' | string;
    langCode: 'en' | string;
    proxy: AccountProxy;
    saveFingerprint: ConfigSaveFingerprint;
    points?: number;
    initialPoints?: number;
    collectedPoints?: number;
    duration?: number;
    rank?: string;
    lastUpdate?: string;
    group?: string;
}
export interface AccountProxy {
    proxyAxios: boolean;
    url: string;
    port: number;
    password?: string;
    username?: string;
    isProxyV6?: boolean;
    bypass?: string;
    /**
     * Optional fallback IPv4 proxy. When set together with a non-empty bypass list
     * (root `bypass.txt`), browser traffic to bypass-matched hosts will be routed
     * through this proxy instead of the main (typically IPv6) one.
     */
    v4?: AccountProxyV4;
}
export interface AccountProxyV4 {
    url: string;
    port: number;
    username?: string;
    password?: string;
}
export interface ConfigSaveFingerprint {
    mobile: boolean;
    desktop: boolean;
}
//# sourceMappingURL=Account.d.ts.map