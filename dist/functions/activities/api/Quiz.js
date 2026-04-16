import { Workers } from '../../Workers.js';
export class Quiz extends Workers {
    cookieHeader = '';
    fingerprintHeader = {};
    oldBalance = this.bot.userData.currentPoints;
    async doQuiz(promotion, page) {
        const offerId = promotion.offerId;
        const url = promotion.destinationUrl;
        this.oldBalance = Number(this.bot.userData.currentPoints ?? 0);
        const startBalance = this.oldBalance;
        this.bot.logger.info(this.bot.isMobile, 'QUIZ', `Starting quiz | offerId=${offerId} | pointProgressMax=${promotion.pointProgressMax} | activityProgressMax=${promotion.activityProgressMax} | currentPoints=${startBalance}`);
        try {
            this.cookieHeader = (this.bot.isMobile ? this.bot.cookies.mobile : this.bot.cookies.desktop)
                .map((c) => `${c.name}=${c.value}`)
                .join('; ');
            const fingerprintHeaders = { ...this.bot.fingerprint.headers };
            delete fingerprintHeaders['Cookie'];
            delete fingerprintHeaders['cookie'];
            this.fingerprintHeader = fingerprintHeaders;
            this.bot.logger.debug(this.bot.isMobile, 'QUIZ', `Prepared quiz headers | offerId=${offerId} | cookieLength=${this.cookieHeader.length} | fingerprintHeaderKeys=${Object.keys(this.fingerprintHeader).length}`);
            // 8-question quiz
            if (promotion.activityProgressMax === 80) {
                this.bot.logger.warn(this.bot.isMobile, 'QUIZ', `Detected 8-question quiz (activityProgressMax=80), falling back to browser visit | offerId=${offerId}`);
                await this.browserVisit(url, page);
                return;
            }
            //Standard points quizzes (20/30/40/50 max)
            if ([20, 30, 40, 50].includes(promotion.pointProgressMax)) {
                let oldBalance = startBalance;
                let gainedPoints = 0;
                const maxAttempts = 20;
                let totalGained = 0;
                let attempts = 0;
                this.bot.logger.debug(this.bot.isMobile, 'QUIZ', `Starting ReportActivity loop | offerId=${offerId} | maxAttempts=${maxAttempts} | startingBalance=${oldBalance}`);
                for (let i = 0; i < maxAttempts; i++) {
                    try {
                        const jsonData = {
                            UserId: null,
                            TimeZoneOffset: -60,
                            OfferId: offerId,
                            ActivityCount: 1,
                            QuestionIndex: '-1'
                        };
                        const request = {
                            url: 'https://www.bing.com/bingqa/ReportActivity?ajaxreq=1',
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                                cookie: this.cookieHeader,
                                ...this.fingerprintHeader
                            },
                            data: JSON.stringify(jsonData)
                        };
                        this.bot.logger.debug(this.bot.isMobile, 'QUIZ', `Sending ReportActivity request | attempt=${i + 1}/${maxAttempts} | offerId=${offerId} | url=${request.url}`);
                        const response = await this.bot.axios.request(request);
                        this.bot.logger.debug(this.bot.isMobile, 'QUIZ', `Received ReportActivity response | attempt=${i + 1}/${maxAttempts} | offerId=${offerId} | status=${response.status}`);
                        const newBalance = await this.bot.browser.func.getCurrentPoints();
                        gainedPoints = newBalance - oldBalance;
                        totalGained += gainedPoints;
                        this.bot.logger.debug(this.bot.isMobile, 'QUIZ', `Balance delta in loop | attempt=${i + 1}/${maxAttempts} | offerId=${offerId} | oldBalance=${oldBalance} | newBalance=${newBalance} | gainedPoints=${gainedPoints} | totalGained=${totalGained}`);
                        if (totalGained >= promotion.pointProgressMax) {
                            this.bot.userData.currentPoints = newBalance;
                            this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + totalGained;
                            this.bot.logger.info(this.bot.isMobile, 'QUIZ', `Completed Quiz via API | offerId=${offerId} | attempts=${i + 1} | gainedPoints=${totalGained} | newBalance=${newBalance}`, 'green');
                            return;
                        }
                        oldBalance = newBalance;
                        attempts++;
                        await this.bot.utils.wait(this.bot.utils.randomDelay(1000, 3000));
                    }
                    catch (error) {
                        this.bot.logger.error(this.bot.isMobile, 'QUIZ', `Error in Quiz loop | offerId=${offerId} | attempt=${i + 1} | message=${error instanceof Error ? error.message : String(error)}`);
                    }
                }
                this.bot.logger.warn(this.bot.isMobile, 'QUIZ', `Quiz API loop finished without reaching target points, falling back to browser visit | offerId=${offerId} | totalGained=${totalGained}/${promotion.pointProgressMax}`);
                await this.browserVisit(url, page);
            }
            else {
                this.bot.logger.warn(this.bot.isMobile, 'QUIZ', `Unsupported quiz configuration, falling back to browser visit | offerId=${offerId} | pointProgressMax=${promotion.pointProgressMax}`);
                await this.browserVisit(url, page);
            }
        }
        catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'QUIZ', `Error in Quiz solver, falling back to browser visit | offerId=${offerId} | message=${error instanceof Error ? error.message : String(error)}`);
            await this.browserVisit(url, page);
        }
    }
    async browserVisit(url, page) {
        if (!page) {
            this.bot.logger.warn(this.bot.isMobile, 'BROWSER-VISIT', 'Cannot perform browser visit: page is missing');
            return;
        }
        try {
            this.bot.logger.info(this.bot.isMobile, 'BROWSER-VISIT', `Visiting Quiz URL in browser | url=${url}`);
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
//# sourceMappingURL=Quiz.js.map