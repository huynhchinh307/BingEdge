import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { getDirname, getProjectRoot, loadAccounts, log } from '../utils.js';

const __dirname = getDirname(import.meta.url);
const projectRoot = getProjectRoot(__dirname);

// Track active processes and their limits
const activeProcesses = {};
const processLogs = {}; // key -> string[]

// Persist account stats in memory only
let accountStats = {}; // email -> { total, oldBalance, newBalance, duration, completedAt }

function saveAccountStats() {
    // No longer saving to disk as requested, keeping in memory for real-time dashboard updates
}

// Parse ACCOUNT-END log line to extract stats
// Format: ... [ACCOUNT-END] Completed account: email | Total: +N | Old: X → New: Y | Duration: Z.Ws
function parseAccountEndLog(line, email) {
    if (!line.includes('[ACCOUNT-END]')) return;
    const totalMatch = line.match(/Total: ([+-]?\d+)/);
    const oldMatch = line.match(/Old: (\d+)/);
    const newMatch = line.match(/New: (\d+)/);
    const durMatch = line.match(/Duration: ([\d.]+)s/);
    const rankMatch = line.match(/Rank: ([^|]*)/);
    if (totalMatch) {
        accountStats[email] = {
            total: parseInt(totalMatch[1]),
            oldBalance: oldMatch ? parseInt(oldMatch[1]) : null,
            newBalance: newMatch ? parseInt(newMatch[1]) : null,
            duration: durMatch ? parseFloat(durMatch[1]) : null,
            rank: rankMatch ? rankMatch[1].trim() : (accountStats[email]?.rank || null),
            completedAt: new Date().toISOString()
        };
        saveAccountStats();
    }
}

// CPU usage sampler
let lastCpuSample = os.cpus();
let cpuUsagePercent = 0;

function sampleCpu() {
    const currentCpus = os.cpus();
    let totalIdle = 0, totalTick = 0;
    for (let i = 0; i < currentCpus.length; i++) {
        const curr = currentCpus[i].times;
        const prev = lastCpuSample[i].times;
        const idle = curr.idle - prev.idle;
        const total = Object.values(curr).reduce((a, b) => a + b, 0)
                    - Object.values(prev).reduce((a, b) => a + b, 0);
        totalIdle += idle;
        totalTick += total;
    }
    cpuUsagePercent = totalTick > 0 ? Math.round((1 - totalIdle / totalTick) * 100) : 0;
    lastCpuSample = currentCpus;
}
setInterval(sampleCpu, 1000);

const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.method === 'GET' && req.url === '/') {
        const htmlPath = path.join(__dirname, 'dashboard.html');
        // Serve HTML
        if (fs.existsSync(htmlPath)) {
            const html = fs.readFileSync(htmlPath, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
        } else {
            res.writeHead(404);
            res.end('dashboard.html not found');
        }
        return;
    }

    if (req.method === 'GET' && req.url === '/api/stats') {
        const totalRam = os.totalmem();
        const freeRam = os.freemem();
        const usedRam = totalRam - freeRam;
        const toGB = (b) => (b / 1024 / 1024 / 1024).toFixed(1);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            cpu: cpuUsagePercent,
            cpuModel: os.cpus()[0]?.model?.split(' ').slice(0, 3).join(' ') || 'CPU',
            cpuCores: os.cpus().length,
            ramUsed: toGB(usedRam),
            ramTotal: toGB(totalRam),
            ramPercent: Math.round((usedRam / totalRam) * 100),
            activeSessions: Object.keys(activeProcesses).length,
            platform: os.platform(),
            uptime: Math.floor(os.uptime())
        }));
        return;
    }

    if (req.method === 'GET' && req.url === '/api/config') {
        try {
            const isDev = process.argv.includes('-dev');
            let configPath = path.join(projectRoot, 'dist', 'config.json');
            if (isDev) configPath = path.join(projectRoot, 'src', 'config.json');
            else if (!fs.existsSync(configPath)) configPath = path.join(projectRoot, 'config.json');
            
            const data = fs.readFileSync(configPath, 'utf-8');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, config: data }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: e.message }));
        }
        return;
    }

    if (req.method === 'POST' && req.url === '/api/config') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                JSON.parse(data.config); 
                
                const isDev = process.argv.includes('-dev');
                let configPath = path.join(projectRoot, 'dist', 'config.json');
                if (isDev) configPath = path.join(projectRoot, 'src', 'config.json');
                else if (!fs.existsSync(configPath)) configPath = path.join(projectRoot, 'config.json');

                fs.writeFileSync(configPath, data.config, 'utf-8');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch(e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Invalid JSON format or write error' }));
            }
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/api/accounts/delete') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const reqData = JSON.parse(body);
                
                const isDev = process.argv.includes('-dev');
                let accPath = path.join(projectRoot, 'dist', 'accounts.json');
                if (isDev) accPath = path.join(projectRoot, 'src', 'accounts.dev.json');
                else if (!fs.existsSync(accPath)) accPath = path.join(projectRoot, 'accounts.json');

                let accs = [];
                try {
                    const existing = fs.readFileSync(accPath, 'utf-8');
                    accs = JSON.parse(existing);
                } catch(e) {}
                
                const initialLen = accs.length;
                accs = accs.filter(a => a.email !== reqData.email);
                
                if (accs.length === initialLen) throw new Error('Account not found');

                fs.writeFileSync(accPath, JSON.stringify(accs, null, 4), 'utf-8');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch(e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/accounts/get')) {
        try {
            const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
            const email = urlParams.get('email');
            const isDev = process.argv.includes('-dev');
            let accPath = path.join(projectRoot, 'dist', 'accounts.json');
            if (isDev) accPath = path.join(projectRoot, 'src', 'accounts.dev.json');
            else if (!fs.existsSync(accPath)) accPath = path.join(projectRoot, 'accounts.json');

            const accs = JSON.parse(fs.readFileSync(accPath, 'utf-8'));
            const acc = accs.find(a => a.email === email);
            if (!acc) throw new Error('Account not found');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, account: acc }));
        } catch(e) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: e.message }));
        }
        return;
    }

    if (req.method === 'POST' && req.url === '/api/accounts/update') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { originalEmail, account } = JSON.parse(body);
                const isDev = process.argv.includes('-dev');
                let accPath = path.join(projectRoot, 'dist', 'accounts.json');
                if (isDev) accPath = path.join(projectRoot, 'src', 'accounts.dev.json');
                else if (!fs.existsSync(accPath)) accPath = path.join(projectRoot, 'accounts.json');

                let accs = JSON.parse(fs.readFileSync(accPath, 'utf-8'));
                const idx = accs.findIndex(a => a.email === originalEmail);
                if (idx === -1) throw new Error('Account not found');
                accs[idx] = { ...accs[idx], ...account };
                fs.writeFileSync(accPath, JSON.stringify(accs, null, 4), 'utf-8');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch(e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/api/accounts/add') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const newAcc = JSON.parse(body);
                
                const isDev = process.argv.includes('-dev');
                let accPath = path.join(projectRoot, 'dist', 'accounts.json');
                if (isDev) accPath = path.join(projectRoot, 'src', 'accounts.dev.json');
                else if (!fs.existsSync(accPath)) accPath = path.join(projectRoot, 'accounts.json');

                let accs = [];
                try {
                    const existing = fs.readFileSync(accPath, 'utf-8');
                    accs = JSON.parse(existing);
                } catch(e) {}
                accs.push(newAcc);
                fs.writeFileSync(accPath, JSON.stringify(accs, null, 4), 'utf-8');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch(e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    if (req.method === 'GET' && req.url === '/api/accounts') {
        try {
            const isDev = process.argv.includes('-dev');
            const { data: accounts } = loadAccounts(projectRoot, isDev);
            
            const cleanAccounts = accounts.filter(a => a && a.email).map(a => {
                const isActiveDesktop = activeProcesses[`${a.email}-desktop`] !== undefined;
                const isActiveMobile = activeProcesses[`${a.email}-mobile`] !== undefined;
                const isActiveBot = activeProcesses[`${a.email}-bot`] !== undefined;
                return {
                    email: a.email,
                    proxy: a.proxy?.url ? `${a.proxy.url}:${a.proxy.port}` : 'None',
                    isActiveDesktop,
                    isActiveMobile,
                    isActiveBot,
                    stats: accountStats[a.email] || (a.initialPoints !== undefined ? {
                        total: a.collectedPoints,
                        oldBalance: a.initialPoints,
                        newBalance: a.points,
                        duration: a.duration,
                        rank: a.rank,
                        completedAt: a.lastUpdate
                    } : null),
                    points: a.points || 0,
                    rank: accountStats[a.email]?.rank || a.rank || 'N/A',
                    lastUpdate: a.lastUpdate || 'Never'
                }
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, accounts: cleanAccounts }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: e.message }));
        }
        return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/logs')) {
        const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
        const email = urlParams.get('email');
        const type = urlParams.get('type');
        const key = `${email}-${type}`;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, logs: processLogs[key] || [] }));
        return;
    }

    if (req.method === 'POST' && req.url === '/api/open') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { email, type } = data; // type: 'desktop' | 'mobile' | 'bot'
                const key = `${email}-${type}`;

                if (activeProcesses[key]) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Session is already active' }));
                    return;
                }

                log('INFO', `Dashboard: Opening ${type} session for ${email}`);

                let args;
                if (type === 'bot') {
                    args = ['./dist/index.js', '-email', email];
                } else {
                    args = ['./scripts/main/browserSession.js', '-email', email, '-force'];
                    if (type === 'mobile') args.push('-mobile');
                }

                // Using spawn but attached tracking to update status on close
                const cp = spawn('node', args, { cwd: projectRoot });
                
                activeProcesses[key] = cp.pid;
                processLogs[key] = [];
                let lineBuffer = '';

                // Strip ANSI color/escape codes from log lines
                const stripAnsi = (str) => str.replace(/\x1b\[[0-9;]*m/g, '');

                const processLine = (line) => {
                    const clean = stripAnsi(line).trim();
                    if (!clean) return;
                    processLogs[key].push(clean);
                    if (type === 'bot') parseAccountEndLog(clean, email);
                };

                const addLog = (data) => {
                    const str = data.toString();
                    process.stdout.write(str);

                    // Buffer-aware line splitting — handles partial chunks
                    lineBuffer += str;
                    const parts = lineBuffer.split('\n');
                    // All parts except the last are complete lines
                    for (let i = 0; i < parts.length - 1; i++) {
                        processLine(parts[i]);
                    }
                    // Last part is potentially incomplete — keep in buffer
                    lineBuffer = parts[parts.length - 1];

                    if (processLogs[key].length > 300) {
                        processLogs[key] = processLogs[key].slice(-300);
                    }
                };

                cp.stdout.on('data', addLog);
                cp.stderr.on('data', addLog);

                cp.on('exit', () => {
                    // Flush any remaining buffered content
                    if (lineBuffer.trim()) processLine(lineBuffer);
                    lineBuffer = '';
                    log('INFO', `Dashboard: Session closed for ${key}`);
                    delete activeProcesses[key];
                });


                cp.on('error', (err) => {
                    log('ERROR', `Dashboard: Error in ${key}: ${err.message}`);
                    delete activeProcesses[key];
                });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Process started', pid: cp.pid }));
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/api/stop') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { email, type } = data;
                const key = `${email}-${type}`;

                const pid = activeProcesses[key];
                if (pid) {
                    process.kill(pid);
                    delete activeProcesses[key];
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: 'Process stopped' }));
                } else {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Process not found or already closed' }));
                }
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

const PORT = 3000;
server.listen(PORT, () => {
    log('INFO', `Dashboard is running on http://localhost:${PORT}`);
    log('INFO', `Click here to open: http://localhost:${PORT}`);
});
