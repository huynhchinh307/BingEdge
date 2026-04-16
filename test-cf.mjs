import patchright from 'patchright';

(async () => {
    const b = await patchright.chromium.launch({ headless: true });
    const c = await b.newContext();
    const p = await c.newPage();
    await p.goto('https://nowsecure.nl'); // Known cloudflare Turnstile testing site.
    await new Promise(r=>setTimeout(r, 6000));
    await p.screenshot({ path: 'cf-test.png' });
    await b.close();
})();
