"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorDiagnostic = errorDiagnostic;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
async function errorDiagnostic(page, error) {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const folderName = `error-${timestamp}`;
        const outputDir = path_1.default.join(process.cwd(), 'diagnostics', folderName);
        if (!page) {
            return;
        }
        if (page.isClosed()) {
            return;
        }
        // Error log content
        const errorLog = `
Name: ${error.name}
Message: ${error.message}
Timestamp: ${new Date().toISOString()}
---------------------------------------------------
Stack Trace:
${error.stack || 'No stack trace available'}
        `.trim();
        const [htmlContent, screenshotBuffer] = await Promise.all([
            page.content(),
            page.screenshot({ fullPage: true, type: 'png' })
        ]);
        await promises_1.default.mkdir(outputDir, { recursive: true });
        await Promise.all([
            promises_1.default.writeFile(path_1.default.join(outputDir, 'dump.html'), htmlContent),
            promises_1.default.writeFile(path_1.default.join(outputDir, 'screenshot.png'), screenshotBuffer),
            promises_1.default.writeFile(path_1.default.join(outputDir, 'error.txt'), errorLog)
        ]);
        console.log(`Diagnostics saved to: ${outputDir}`);
    }
    catch (error) {
        console.error('Unable to create error diagnostics:', error);
    }
}
//# sourceMappingURL=ErrorDiagnostic.js.map