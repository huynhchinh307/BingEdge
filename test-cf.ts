import patchright from 'patchright'

async function run() {
    const browser = await patchright.chromium.launch({
        headless: true,
        args: [
            // I'll test basic args
        ]
    })
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto('https://nowsecure.nl')
    
    // wait for 5 seconds to let turnstile resolve
    await new Promise(r => setTimeout(r, 6000))
    await page.screenshot({ path: 'cf-test.png' })
    await browser.close()
}
run()
