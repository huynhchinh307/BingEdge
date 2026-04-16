/**
 * Post-build script: Add .js extensions to all relative local imports/exports
 * in compiled dist/ files. Required for Node.js v22+ ESM strict resolution.
 * 
 * Node.js ESM requires explicit .js extensions for file imports, but TypeScript
 * with moduleResolution:node compiles WITHOUT adding them.
 */

const fs = require('fs')
const path = require('path')

const DIST_DIR = path.join(__dirname, '..', 'dist')

// Matches: from './foo' | from '../bar/baz' | export * from './qux'
// Does NOT match: from 'node:...' | from 'package-name'
const RELATIVE_IMPORT_RE = /(\bfrom\s+['"])(\.{1,2}\/[^'"]+)(['"])/g
const EXPORT_RE = /(\bexport\s+.*?\bfrom\s+['"])(\.{1,2}\/[^'"]+)(['"])/g

function addJsExtension(importPath) {
    // Skip if already has an extension
    if (/\.[a-z]+$/i.test(importPath)) return importPath
    return importPath + '.js'
}

function processFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8')
    let changed = false

    const newContent = content.replace(RELATIVE_IMPORT_RE, (match, before, importPath, after) => {
        const fixed = addJsExtension(importPath)
        if (fixed !== importPath) {
            changed = true
            return before + fixed + after
        }
        return match
    })

    if (changed) {
        fs.writeFileSync(filePath, newContent, 'utf8')
        console.log(`[fix-esm] Patched: ${path.relative(DIST_DIR, filePath)}`)
    }
}

function walkDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            walkDir(fullPath)
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            processFile(fullPath)
        }
    }
}

if (!fs.existsSync(DIST_DIR)) {
    console.error('[fix-esm] dist/ directory not found. Run build first.')
    process.exit(1)
}

console.log('[fix-esm] Adding .js extensions to local imports in dist/...')
walkDir(DIST_DIR)
console.log('[fix-esm] Done.')
