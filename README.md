# 🌟 Microsoft Rewards Script (Patchright Edition)

An advanced, high-performance automation tool for Microsoft Rewards, redesigned with a premium SaaS-like interface and human-like interaction algorithms.

![Dashboard Preview](https://via.placeholder.com/1200x600/1e1e2e/ffffff?text=Premium+Rewards+Dashboard+Interface)

## ✨ Key Features

### 🚀 Premium Dashboard UI
- **Real-time Analytics**: Monitor all your accounts from a single, beautiful dashboard.
- **Rank Visualization**: Custom badges for **Gold Member**, **Silver Member**, and **Member** with luxury shine and glow effects.
- **Compact Modals**: Redesigned **Add Account** and **Global Configuration** windows with a 3-column grid layout — NO scrolling required.

### 🛡️ Human-Like Behavior (Stealth Mode)
- **Strict UI Interaction**: For "More Promotions" and "Daily Set", the bot strictly follows a **Find -> Hover -> Click** pattern on the dashboard and `/earn` page.
- **No Direct Navigation**: Eliminated `page.goto(url)` fallbacks that lead to detection. If the button isn't there, we don't click it.
- **Randomized Delays**: Professional-grade delay algorithms between every action to mimic human study and reading patterns.

### 📊 Advanced Automation
- **Account Rank Aware**: Automatically adjusts task load based on your rank. Silver/Gold accounts perform extra promotional tasks for maximum points.
- **Multi-Worker Support**: Parallel search, daily sets, special promos, punch cards, and more.
- **Proxy Protocol Support**: Full support for HTTP, HTTPS, SOCKS4, and SOCKS5 proxies per account.

## 🛠️ Requirements
- **Node.js**: >= 22.0.0
- **Git**: For source control and updates.

## 🚀 Getting Started

1. **Clone the repository**:
   ```bash
   git clone https://github.com/huynhchinh307/BingEdge.git
   ```
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Run the Dashboard**:
   ```bash
   npm run dashboard
   ```

## ⚙️ Configuration
Access the **Global Configuration** modal directly from the dashboard to tweak:
- **Search Settings**: Visit time, delay min/max, read delay.
- **Workers**: Toggle specific tasks (Daily Set, Mobile Search, Desktop Search, etc.).
- **Discord Webhook**: Get real-time notifications about your account status.

## ⚠️ Disclaimer
This project is for educational purposes only. Use it at your own risk. Automated interaction with Microsoft Rewards may violate their Terms of Service.

## 🤝 Contribution
Found a bug? Have a feature request? Feel free to open an issue or submit a pull request!

---
*Maintained by [huynhchinh307](https://github.com/huynhchinh307)*
