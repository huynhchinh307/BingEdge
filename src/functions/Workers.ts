import type { Page } from 'playwright-chromium'
import type { MicrosoftRewardsBot } from '../index'
import type {
    DashboardData,
    PunchCard,
    BasePromotion,
    PurplePromotionalItem
} from '../interface/DashboardData'
import type { AppDashboardData } from '../interface/AppDashBoardData'

export class Workers {
    public bot: MicrosoftRewardsBot

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    public async doDailySet(data: DashboardData, page: Page) {
        let todayKey = this.bot.utils.getFormattedDate()
        let todayData = data.dailySetPromotions[todayKey]

        this.bot.logger.debug(this.bot.isMobile, 'DAILY-SET', `Searching for Daily Set | Key: ${todayKey} | Found: ${!!todayData}`)

        if (!todayData) {
            // Fallback: looking for any key that has uncompleted items
            const keys = Object.keys(data.dailySetPromotions)
            this.bot.logger.debug(this.bot.isMobile, 'DAILY-SET', `Today key not found, searching in other keys: [${keys.join(', ')}]`)

            for (const key of keys) {
                const hasUncompleted = data.dailySetPromotions[key]?.some(x => this.isActivityUncompleted(x))
                if (hasUncompleted) {
                    this.bot.logger.info(this.bot.isMobile, 'DAILY-SET', `Date mismatch? Found uncompleted items in key: ${key}`)
                    todayKey = key
                    todayData = data.dailySetPromotions[key]
                    break
                }
            }
        }

        const activitiesUncompleted = todayData?.filter(x => this.isActivityUncompleted(x)) ?? []

        if (!activitiesUncompleted.length) {
            this.bot.logger.info(this.bot.isMobile, 'DAILY-SET', 'All "Daily Set" items have already been completed or were skipped based on filters')
            return
        }

        this.bot.logger.info(this.bot.isMobile, 'DAILY-SET', `Started solving ${activitiesUncompleted.length} "Daily Set" items`)

        await this.solveActivities(activitiesUncompleted, page)

        this.bot.logger.info(this.bot.isMobile, 'DAILY-SET', 'All "Daily Set" items have been completed')
    }

    public async doMorePromotions(page: Page) {
        this.bot.logger.info(this.bot.isMobile, 'MORE-PROMOTIONS', 'Starting "More Promotions" items')

        // getDashboardData already returns DashboardData object
        const data = await this.bot.browser.func.getDashboardData()
        const rank = this.bot.browser.func.getAccountRank()
        
        const morePromotionsList = [...(data.morePromotions ?? [])]
        
        // If not the base "Member" rank (e.g. is Silver Member, Gold Member), we can do morePromotionsWithoutPromotionalItems
        if (rank && rank !== 'Member') {
            this.bot.logger.info(this.bot.isMobile, 'MORE-PROMOTIONS', `Rank is ${rank}, adding extra promotions from non-promotional items list`)
            morePromotionsList.push(...(data.morePromotionsWithoutPromotionalItems ?? []))
        }

        // Deduplicate and filter for uncompleted tasks
        const morePromotions: BasePromotion[] = [
            ...new Map(
                morePromotionsList
                    .filter(Boolean)
                    .map(p => [p.offerId, p as BasePromotion] as const)
            ).values()
        ]

        const activitiesUncompleted = morePromotions.filter(x => this.isActivityUncompleted(x))

        if (!activitiesUncompleted.length) {
            this.bot.logger.info(
                this.bot.isMobile,
                'MORE-PROMOTIONS',
                'All "More Promotion" items have already been completed'
            )
            return
        }

        this.bot.logger.info(
            this.bot.isMobile,
            'MORE-PROMOTIONS',
            `Started solving ${activitiesUncompleted.length} "More Promotions" items`
        )

        // For more promotions, we use the earn page for better coverage
        await this.solveActivities(activitiesUncompleted, page, undefined, 'https://rewards.bing.com/earn')

        this.bot.logger.info(this.bot.isMobile, 'MORE-PROMOTIONS', 'All "More Promotion" items have been completed')
    }

    public async doAppPromotions(data: AppDashboardData) {
        const appRewards = data.response.promotions.filter(x => {
            if (x.attributes['complete']?.toLowerCase() !== 'false') return false
            if (!x.attributes['offerid']) return false
            if (!x.attributes['type']) return false
            if (x.attributes['type'] !== 'sapphire') return false

            return true
        })

        if (!appRewards.length) {
            this.bot.logger.info(
                this.bot.isMobile,
                'APP-PROMOTIONS',
                'All "App Promotions" items have already been completed'
            )
            return
        }

        for (const reward of appRewards) {
            await this.bot.activities.doAppReward(reward)
            // A delay between completing each activity
            await this.bot.utils.wait(this.bot.utils.randomDelay(5000, 15000))
        }

        this.bot.logger.info(this.bot.isMobile, 'APP-PROMOTIONS', 'All "App Promotions" items have been completed')
    }

    public async doSpecialPromotions(data: DashboardData) {
        const specialPromotions: PurplePromotionalItem[] = [
            ...new Map(
                [...(data.promotionalItems ?? [])]
                    .filter(Boolean)
                    .map(p => [p.offerId, p as PurplePromotionalItem] as const)
            ).values()
        ]

        const supportedPromotions = ['ww_banner_optin_2x']

        const specialPromotionsUncompleted: PurplePromotionalItem[] =
            specialPromotions?.filter(x => {
                if (this.isActivityCompleted(x)) return false
                if (x.exclusiveLockedFeatureStatus === 'locked') return false
                if (!x.promotionType) return false

                const offerId = (x.offerId ?? '').toLowerCase()
                return supportedPromotions.some(s => offerId.includes(s))
            }) ?? []

        for (const activity of specialPromotionsUncompleted) {
            try {
                const type = activity.promotionType?.toLowerCase() ?? ''
                const name = activity.name?.toLowerCase() ?? ''
                const offerId = (activity as PurplePromotionalItem).offerId

                this.bot.logger.debug(
                    this.bot.isMobile,
                    'SPECIAL-ACTIVITY',
                    `Processing activity | title="${activity.title}" | offerId=${offerId} | type=${type}"`
                )

                switch (type) {
                    // UrlReward
                    case 'urlreward': {
                        // Special "Double Search Points" activation
                        if (name.includes('ww_banner_optin_2x')) {
                            this.bot.logger.info(
                                this.bot.isMobile,
                                'ACTIVITY',
                                `Found activity type "Double Search Points" | title="${activity.title}" | offerId=${offerId}`
                            )

                            await this.bot.activities.doDoubleSearchPoints(activity)
                        }
                        break
                    }

                    // Unsupported types
                    default: {
                        this.bot.logger.warn(
                            this.bot.isMobile,
                            'SPECIAL-ACTIVITY',
                            `Skipped activity "${activity.title}" | offerId=${offerId} | Reason: Unsupported type "${activity.promotionType}"`
                        )
                        break
                    }
                }
            } catch (error) {
                this.bot.logger.error(
                    this.bot.isMobile,
                    'SPECIAL-ACTIVITY',
                    `Error while solving activity "${activity.title}" | message=${error instanceof Error ? error.message : String(error)}`
                )
            }
        }

        this.bot.logger.info(this.bot.isMobile, 'SPECIAL-ACTIVITY', 'All "Special Activites" items have been completed')
    }

    private async solveActivities(activities: BasePromotion[], page: Page, punchCard?: PunchCard, targetUrl: string = 'https://rewards.bing.com/dashboard') {
        // Prepare dashboard for UI-based clicking
        let onDashboard = false

        for (const activity of activities) {
            try {
                const offerId = activity.offerId

                this.bot.logger.info(
                    this.bot.isMobile,
                    'ACTIVITY',
                    `Processing activity | title="${activity.title}" | offerId=${offerId} | type=${activity.promotionType}`
                )

                // Navigation to dashboard/earn page for UI-based solving
                if (!onDashboard) {
                    this.bot.logger.debug(this.bot.isMobile, 'DASHBOARD', `Navigating to ${targetUrl} for UI-based solving`)
                    await page.goto(targetUrl, { waitUntil: 'networkidle' })
                    onDashboard = true

                    // Elements will be revealed on-demand in solveActivityViaUI if the link is not found
                }

                // UI-based solver as requested: Hover -> Click -> Wait -> Close
                const solvedViaUI = await this.solveActivityViaUI(activity, page)
                
                if (solvedViaUI) {
                    this.bot.logger.debug(this.bot.isMobile, 'ACTIVITY', `Successfully completed activity via UI click | title="${activity.title}"`)
                    continue 
                }

                this.bot.logger.warn(this.bot.isMobile, 'ACTIVITY', `Could not find UI element for "${activity.title}". Skipping to avoid unnatural direct URL navigation.`)
                continue // Skip if not found in UI to remain human-like

                // Cooldown
                await this.bot.utils.wait(this.bot.utils.randomDelay(5000, 15000))
            } catch (error) {
                this.bot.logger.error(
                    this.bot.isMobile,
                    'ACTIVITY',
                    `Error while solving activity "${activity.title}" | message=${error instanceof Error ? error.message : String(error)}`
                )
            }
        }
    }

    private async revealDailySetElements(page: Page) {
        // Optional: Click expander buttons if needed (dynamic React Aria elements)
        const revealSelectors = [
            'button:has-text("Get Started")',
            'button:has-text("Join now")',
            '#dailyset button[aria-expanded="false"]',
            'button[id*="react-aria"][id$="_r_1_"]', // Specific ID pattern reported by user
            'button[id^="react-aria"][id$="_r_1_"]'
        ]
        
        this.bot.logger.debug(this.bot.isMobile, 'DASHBOARD-UI', 'Checking for reveal elements on dashboard')
        for (const selector of revealSelectors) {
            try {
                const btn = page.locator(selector).first()
                if (await btn.count() > 0) {
                    this.bot.logger.debug(this.bot.isMobile, 'DASHBOARD-UI', `Clicking reveal element: ${selector}`)
                    await btn.click({ timeout: 5000, force: true }).catch(() => null)
                    await this.bot.utils.wait(2000) // Wait for elements to appear
                }
            } catch (e) { /* ignore */ }
        }
    }

    private async solveActivityViaUI(activity: BasePromotion, page: Page): Promise<boolean> {
        const offerId = activity.offerId
        this.bot.logger.debug(this.bot.isMobile, 'DASHBOARD-UI', `Attempting UI solve for "${activity.title}" | offerId=${offerId}`)

        try {
            const findElement = async () => {
                const selectors = [
                    `#dailyset a[href*="${offerId}"]`,
                    `#dailyset a[href*="${encodeURIComponent(offerId)}"]`,
                    `a[href*="${offerId}"]`,
                    `#dailyset a:has-text("${activity.title}")`,
                    `a:has-text("${activity.title}")`
                ]
                
                for (const selector of selectors) {
                    const loc = page.locator(selector).first()
                    if (await loc.isVisible()) return loc
                }
                return null
            }

            let element = await findElement()

            if (!element) {
                this.bot.logger.debug(this.bot.isMobile, 'DASHBOARD-UI', `Link for "${activity.title}" not found, checking if it is hidden...`)
                await this.revealDailySetElements(page)
                element = await findElement()
            }

            if (!element) {
                return false // Could not find element even after attempting reveal
            }

            // Click UI flow as requested
            this.bot.logger.info(this.bot.isMobile, 'DASHBOARD-UI', `Clicking dashboard element for "${activity.title}"`)
            
            await element.scrollIntoViewIfNeeded()
            await element.hover()
            await this.bot.utils.wait(500)

            // Listen for new tab being opened
            const [newPage] = await Promise.all([
                page.context().waitForEvent('page', { timeout: 8000 }).catch(() => null),
                element.click()
            ])

            const waitTime = this.bot.utils.randomDelay(5000, 15000)
            this.bot.logger.info(this.bot.isMobile, 'DASHBOARD-UI', `Visit started. Waiting ${Math.round(waitTime/1000)}s...`)

            if (newPage) {
                await this.bot.utils.wait(waitTime)
                await newPage.close()
                this.bot.logger.debug(this.bot.isMobile, 'DASHBOARD-UI', 'Closed spawned tab')
            } else {
                // If it opened in the same window (user's point)
                await this.bot.utils.wait(waitTime)
                
                // If it navigated away, go back to dashboard for next tasks
                if (!page.url().includes('rewards.bing.com/dashboard')) {
                    this.bot.logger.debug(this.bot.isMobile, 'DASHBOARD-UI', 'Task opened in same tab, navigating back')
                    await page.goBack({ waitUntil: 'networkidle' }).catch(async () => {
                        // Fallback if back fails
                        await page.goto('https://rewards.bing.com/dashboard', { waitUntil: 'networkidle' })
                    })
                }
            }

            return true
        } catch (error) {
            this.bot.logger.debug(this.bot.isMobile, 'DASHBOARD-UI', `UI Solve failed for "${activity.title}": ${error instanceof Error ? error.message : String(error)}`)
            return false
        }
    }

    private isActivityUncompleted(x: BasePromotion): boolean {
        const isCompleted = this.isActivityCompleted(x)
        const hasPoints = x.pointProgressMax > 0 || (x.attributes?.max && parseInt(x.attributes.max) > 0)
        const isLocked = x.exclusiveLockedFeatureStatus === 'locked'
        const hasType = !!x.promotionType

        if (!isCompleted && hasPoints && !isLocked && hasType) {
            return true
        }

        // Detailed logging for why we skip something that is not completed
        if (!isCompleted && (!hasPoints || isLocked || !hasType)) {
            this.bot.logger.debug(this.bot.isMobile, 'ACTIVITY-SKIP', `Skipping uncompleted activity "${x.title}" | Reason: HasPoints=${hasPoints}, IsLocked=${isLocked}, HasType=${hasType}`)
        }

        return false
    }

    private isActivityCompleted(x: BasePromotion | PurplePromotionalItem): boolean {
        // Check root complete field (boolean or string)
        if (x.complete === true || String(x.complete).toLowerCase() === 'true') {
            return true
        }

        // Check attributes complete field
        if (x.attributes?.complete === true || String(x.attributes?.complete).toLowerCase() === 'true') {
            return true
        }

        // Check state field
        if (x.attributes?.state?.toLowerCase() === 'complete') {
            return true
        }

        return false
    }
}
