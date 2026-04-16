import { Workers } from '../../Workers.js';
export class UrlReward extends Workers {
    cookieHeader = '';
    fingerprintHeader = {};
    gainedPoints = 0;
    oldBalance = this.bot.userData.currentPoints;
    async doUrlReward(promotion, page) {
        const url = promotion.destinationUrl;
        if (!this.bot.requestToken && this.bot.rewardsVersion === 'legacy') {
            this.bot.logger.warn(this.bot.isMobile, 'URL-REWARD', `No request token available, falling back to browser visit | offerId=${promotion.offerId}`);
            await this.browserVisit(url, page);
            return;
        }
        const offerId = promotion.offerId;
        this.bot.logger.info(this.bot.isMobile, 'URL-REWARD', `Starting UrlReward | offerId=${offerId} | geo=${this.bot.userData.geoLocale} | oldBalance=${this.oldBalance}`);
        try {
            this.cookieHeader = (this.bot.isMobile ? this.bot.cookies.mobile : this.bot.cookies.desktop)
                .map((c) => `${c.name}=${c.value}`)
                .join('; ');
            const fingerprintHeaders = { ...this.bot.fingerprint.headers };
            delete fingerprintHeaders['Cookie'];
            delete fingerprintHeaders['cookie'];
            this.fingerprintHeader = fingerprintHeaders;
            this.bot.logger.debug(this.bot.isMobile, 'URL-REWARD', `Prepared UrlReward headers | offerId=${offerId} | cookieLength=${this.cookieHeader.length} | fingerprintHeaderKeys=${Object.keys(this.fingerprintHeader).length}`);
            const formData = new URLSearchParams({
                id: offerId,
                hash: promotion.hash,
                timeZone: '60',
                activityAmount: '1',
                dbs: '0',
                form: '',
                type: '',
                __RequestVerificationToken: this.bot.requestToken
            });
            this.bot.logger.debug(this.bot.isMobile, 'URL-REWARD', `Prepared UrlReward form data | offerId=${offerId} | hash=${promotion.hash} | timeZone=60 | activityAmount=1`);
            const request = {
                url: 'https://rewards.bing.com/api/reportactivity?X-Requested-With=XMLHttpRequest',
                method: 'POST',
                headers: {
                    ...(this.bot.fingerprint?.headers ?? {}),
                    Cookie: this.cookieHeader,
                    Referer: 'https://rewards.bing.com/',
                    Origin: 'https://rewards.bing.com',
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                data: formData
            };
            this.bot.logger.debug(this.bot.isMobile, 'URL-REWARD', `Sending UrlReward request | offerId=${offerId} | url=${request.url}`);
            const response = await this.bot.axios.request(request);
            this.bot.logger.debug(this.bot.isMobile, 'URL-REWARD', `Received UrlReward response | offerId=${offerId} | status=${response.status}`);
            const newBalance = await this.bot.browser.func.getCurrentPoints();
            this.gainedPoints = newBalance - this.oldBalance;
            this.bot.logger.debug(this.bot.isMobile, 'URL-REWARD', `Balance delta after UrlReward | offerId=${offerId} | oldBalance=${this.oldBalance} | newBalance=${newBalance} | gainedPoints=${this.gainedPoints}`);
            if (this.gainedPoints > 0) {
                this.bot.userData.currentPoints = newBalance;
                this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + this.gainedPoints;
                this.bot.logger.info(this.bot.isMobile, 'URL-REWARD', `Completed UrlReward | offerId=${offerId} | status=${response.status} | gainedPoints=${this.gainedPoints} | newBalance=${newBalance}`, 'green');
            }
            else {
                this.bot.logger.warn(this.bot.isMobile, 'URL-REWARD', `Failed UrlReward with no points, falling back to browser visit | offerId=${offerId} | status=${response.status}`);
                await this.browserVisit(url, page);
            }
            this.bot.logger.debug(this.bot.isMobile, 'URL-REWARD', `Waiting after UrlReward | offerId=${offerId}`);
            await this.bot.utils.wait(this.bot.utils.randomDelay(5000, 10000));
        }
        catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'URL-REWARD', `Error in doUrlReward, falling back to browser visit | offerId=${promotion.offerId} | message=${error instanceof Error ? error.message : String(error)}`);
            await this.browserVisit(url, page);
        }
    }
    async browserVisit(url, page) {
        if (!page) {
            this.bot.logger.warn(this.bot.isMobile, 'BROWSER-VISIT', 'Cannot perform browser visit: page is missing');
            return;
        }
        try {
            this.bot.logger.info(this.bot.isMobile, 'BROWSER-VISIT', `Visiting URL in browser | url=${url}`);
            await page.goto(url);
            // Wait 5-10 seconds as requested by the user
            await this.bot.utils.wait(this.bot.utils.randomDelay(5000, 10000));
            this.bot.logger.info(this.bot.isMobile, 'BROWSER-VISIT', 'Visit completed');
        }
        catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'BROWSER-VISIT', `Error visiting URL in browser | message=${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
//# sourceMappingURL=UrlReward.js.map