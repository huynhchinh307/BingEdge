import fs from 'fs';
import path from 'path';
import { getDirname, getProjectRoot, log, openDb } from '../utils.js';

const __dirname = getDirname(import.meta.url);
const projectRoot = getProjectRoot(__dirname);
const dbPath = path.join(projectRoot, 'rewards_data.db');

const proxyFilePath = path.join(projectRoot, 'proxies.txt');
let proxyList = [];

if (fs.existsSync(proxyFilePath)) {
    proxyList = fs.readFileSync(proxyFilePath, 'utf8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0);
    log('SUCCESS', `Loaded ${proxyList.length} proxies from proxies.txt`);
} else {
    log('WARN', 'proxies.txt not found in project root. Please create it with one proxy (ip:port:user:pass) per line.');
}


function parseProxy(proxyStr) {
    const parts = proxyStr.split(':');
    return {
        url: `http://${parts[0]}`,
        port: parts[1],
        username: parts[2],
        password: parts[3],
        isProxyV6: true
    };
}

async function main() {
    log('INFO', 'Starting proxy assignment for "AutoV2" group...');

    const db = openDb(dbPath, { timeout: 5000 });
    const accounts = db.prepare('SELECT * FROM accounts WHERE account_group = ?').all('AutoV2');

    log('INFO', `Found ${accounts.length} accounts in "AutoV2" group.`);

    // Find accounts without ProxyV6
    const pendingAccounts = accounts.filter(acc => {
        try {
            const proxy = JSON.parse(acc.proxy);
            return !proxy.isProxyV6 || !proxy.url;
        } catch (e) {
            return true;
        }
    });

    log('INFO', `${pendingAccounts.length} accounts need proxy assignment.`);

    if (pendingAccounts.length === 0) {
        log('SUCCESS', 'All accounts already have ProxyV6. Nothing to do.');
        return;
    }

    // Get list of proxies currently in use across ALL groups to avoid duplicates
    const usedProxies = new Set();
    const allAccounts = db.prepare('SELECT proxy FROM accounts').all();
    allAccounts.forEach(acc => {
        try {
            const proxy = JSON.parse(acc.proxy);
            if (proxy.url && proxy.port) {
                const proxyKey = `${proxy.url}:${proxy.port}`;
                usedProxies.add(proxyKey);
            }
        } catch (e) { }
    });

    const availableProxies = proxyList.filter(p => {
        const parts = p.split(':');
        const proxyKey = `http://${parts[0]}:${parts[1]}`;
        return !usedProxies.has(proxyKey);
    });

    log('INFO', `${availableProxies.length} proxies available for assignment (not in use).`);

    let assignedCount = 0;
    const stmt = db.prepare('UPDATE accounts SET proxy = ?, updated_at = ? WHERE email = ?');

    db.transaction(() => {
        for (let i = 0; i < Math.min(pendingAccounts.length, availableProxies.length); i++) {
            const account = pendingAccounts[i];
            const proxyStr = availableProxies[i];
            const proxyObj = parseProxy(proxyStr);

            stmt.run(JSON.stringify(proxyObj), Date.now(), account.email);
            log('SUCCESS', `Assigned proxy ${proxyObj.url}:${proxyObj.port} to ${account.email}`);
            assignedCount++;
        }
    })();

    log('SUCCESS', `Finished! Assigned proxies to ${assignedCount} accounts.`);
    db.close();
}

main().catch(err => {
    log('ERROR', `Fatal error: ${err.message}`);
    process.exit(1);
});
