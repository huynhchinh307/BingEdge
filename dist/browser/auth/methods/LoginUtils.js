import readline from 'readline';
export function promptInput(options) {
    const { question, timeoutSeconds = 60, validate, transform } = options;
    return new Promise(resolve => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        let resolved = false;
        const cleanup = (result) => {
            if (resolved)
                return;
            resolved = true;
            clearTimeout(timer);
            rl.close();
            resolve(result);
        };
        const timer = setTimeout(() => cleanup(null), timeoutSeconds * 1000);
        rl.question(question, answer => {
            let value = answer.trim();
            if (transform)
                value = transform(value);
            if (validate && !validate(value)) {
                cleanup(null);
                return;
            }
            cleanup(value);
        });
    });
}
export async function getSubtitleMessage(page) {
    const message = await page
        .waitForSelector('[data-testid="subtitle"]', { state: 'visible', timeout: 1000 })
        .catch(() => null);
    if (!message)
        return null;
    const text = await message.innerText();
    return text.trim();
}
export async function getErrorMessage(page) {
    const errorAlert = await page
        .waitForSelector('div[role="alert"]', { state: 'visible', timeout: 1000 })
        .catch(() => null);
    if (!errorAlert)
        return null;
    const text = await errorAlert.innerText();
    return text.trim();
}
//# sourceMappingURL=LoginUtils.js.map