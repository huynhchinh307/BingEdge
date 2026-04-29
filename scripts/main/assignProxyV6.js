import Database from 'better-sqlite3';
import path from 'path';
import { getDirname, getProjectRoot, log } from '../utils.js';

const __dirname = getDirname(import.meta.url);
const projectRoot = getProjectRoot(__dirname);
const dbPath = path.join(projectRoot, 'rewards_data.db');

const proxyList = [
    '160.250.54.8:49460:proxyhot49460:sMaqveol',
    '160.250.54.8:49071:proxyhot49071:mzvTDRZW',
    '160.250.54.8:50012:proxyhot50012:CgeyDGHs',
    '160.250.54.8:49566:proxyhot49566:dbPvtppX',
    '160.250.54.8:49571:proxyhot49571:AJILcHBT',
    '160.250.54.8:49803:proxyhot49803:EGpnnwcO',
    '160.250.54.8:49299:proxyhot49299:xqpwxjMf',
    '160.250.54.8:49451:proxyhot49451:rSeQLkwI',
    '160.250.54.8:49311:proxyhot49311:uGAkfVrh',
    '160.250.54.8:49134:proxyhot49134:dwgEfkDM',
    '160.250.54.8:49309:proxyhot49309:ykQOZAgf',
    '160.250.54.8:49064:proxyhot49064:rnOhabVp',
    '160.250.54.8:49837:proxyhot49837:sFjsGDEL',
    '160.250.54.8:49879:proxyhot49879:lgGFDzwA',
    '160.250.54.8:49977:proxyhot49977:VHpMMOKZ',
    '160.250.54.8:49168:proxyhot49168:iGuYGCoB',
    '160.250.54.8:49809:proxyhot49809:tNGkifVJ',
    '160.250.54.8:49315:proxyhot49315:OQfUhDUE',
    '160.250.54.8:49423:proxyhot49423:HbNHfjYI',
    '160.250.54.8:49265:proxyhot49265:CFCYtCRc'
];

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
    log('INFO', 'Starting proxy assignment for "AutoRegister" group...');
    
    const db = new Database(dbPath);
    const accounts = db.prepare('SELECT * FROM accounts WHERE account_group = ?').all('AutoRegister');
    
    log('INFO', `Found ${accounts.length} accounts in "AutoRegister" group.`);
    
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

    // Get list of proxies currently in use to avoid duplicates
    const usedProxies = new Set();
    accounts.forEach(acc => {
        try {
            const proxy = JSON.parse(acc.proxy);
            if (proxy.url && proxy.port) {
                const proxyKey = `${proxy.url}:${proxy.port}`;
                usedProxies.add(proxyKey);
            }
        } catch (e) {}
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
