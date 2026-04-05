import path from 'path'
import fs from 'fs'
import {
    getDirname,
    getProjectRoot,
    log,
    loadJsonFile,
    safeRemoveDirectory
} from '../utils.js'

const __dirname = getDirname(import.meta.url)
const projectRoot = getProjectRoot(__dirname)

const args = parseArgs()
const { data: config, path: configPath } = loadConfig(projectRoot, args.dev)

log('INFO', 'Using config source:', configPath)

if (!config.sessionPath) {
    log('ERROR', 'Invalid configuration - missing required field: sessionPath')
    process.exit(1)
}

log('INFO', 'Session path from config:', config.sessionPath)

const configDir = path.dirname(configPath)
const possibleSessionDirs = [
    path.resolve(configDir, config.sessionPath),
    path.join(projectRoot, 'src/browser', config.sessionPath),
    path.join(projectRoot, 'dist/browser', config.sessionPath)
]

log('DEBUG', 'Searching for session directory...')

let sessionDir = null
for (const p of possibleSessionDirs) {
    log('DEBUG', 'Checking:', p)
    if (fs.existsSync(p)) {
        sessionDir = p
        log('DEBUG', 'Found session directory at:', p)
        break
    }
}

if (!sessionDir) {
    sessionDir = path.resolve(configDir, config.sessionPath)
    log('DEBUG', 'Using fallback session directory:', sessionDir)
}

const success = safeRemoveDirectory(sessionDir, projectRoot)

if (!success) {
    process.exit(1)
}

log('INFO', 'Done.')