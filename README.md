# 🎯 BingReward — Microsoft Rewards Script (Patchright Edition)

An automated script for Microsoft Rewards, powered by [Patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright) for enhanced bot detection bypass.

## Features
- **Patchright Core:** Uses the latest patches to bypass Chromium detection.
- **Stealth focused:** Optimized launch arguments and settings.

---

## ✅ Yêu cầu hệ thống

| Yêu cầu | Phiên bản |
|---|---|
| [Node.js](https://nodejs.org/) | >= 22.0.0 |
| npm | >= 9.0.0 |
| Hệ điều hành | Windows / Linux / macOS |

---

## 🚀 Cài đặt lần đầu

### 1. Clone repo

```bash
git clone https://github.com/huynhchinh307/BingReward.git
cd BingReward
```

### 2. Cài dependencies + build

```bash
npm run pre-build
npm run build
```

> `pre-build` sẽ tự cài node_modules và tải Chromium browser.

### 3. Tạo file cấu hình tài khoản

Copy file mẫu và điền thông tin thật:

```bash
# Windows
copy src\accounts.example.json dist\accounts.json

# Linux / macOS
cp src/accounts.example.json dist/accounts.json
```

Mở `dist/accounts.json` và sửa:

```json
[
    {
        "email": "your_email@gmail.com",
        "password": "your_password",
        "totpSecret": "",
        "recoveryEmail": "",
        "geoLocale": "auto",
        "langCode": "vi",
        "proxy": {
            "proxyAxios": false,
            "url": "",
            "port": 0,
            "username": "",
            "password": ""
        },
        "saveFingerprint": {
            "mobile": true,
            "desktop": true
        }
    }
]
```

> 💡 **Định dạng proxy nhanh:** `host:port:user:pass`  
> Ví dụ: `proxy05.vproxy.online:1234:user123:pass456`  
> Dán vào ô Proxy khi thêm account qua Dashboard — hệ thống tự tách.

### 4. (Tùy chọn) Chỉnh config

Sửa `src/config.json` theo nhu cầu:

| Trường | Mô tả | Mặc định |
|---|---|---|
| `headless` | Ẩn cửa sổ browser khi chạy | `false` |
| `clusters` | Số process song song | `2` |
| `workers.doDailySet` | Làm Daily Set | `true` |
| `workers.doMobileSearch` | Tìm kiếm mobile | `true` |
| `workers.doDesktopSearch` | Tìm kiếm desktop | `true` |
| `workers.doAppPromotions` | App promotions | `true` |
| `searchSettings.searchDelay` | Khoảng cách giữa các lần tìm | `30s–1min` |
| `webhook.discord.url` | Discord webhook URL | `""` |
| `webhook.ntfy.url` | NTFY notification URL | `""` |

---

## 🖥️ Sử dụng Dashboard

Dashboard cung cấp giao diện web để quản lý tài khoản và chạy bot.

### Khởi động nhanh

**Windows:** Click đúp vào file `start-dashboard.bat`

**Hoặc dùng terminal:**

```bash
npm run dashboard
```

Truy cập: **http://localhost:3000**

### Tính năng Dashboard

| Tính năng | Mô tả |
|---|---|
| ➕ **Thêm tài khoản** | Nhập email, password, proxy (hỗ trợ dán `host:port:user:pass`) |
| ✏️ **Sửa tài khoản** | Chỉnh sửa thông tin bất kỳ |
| 🗑️ **Xóa tài khoản** | Xóa khỏi danh sách |
| ▶️ **Chạy Bot** | Chạy bot tự động cho account |
| 🖥️ **Desktop Session** | Mở browser desktop để đăng nhập thủ công |
| 📱 **Mobile Session** | Mở browser mobile để đăng nhập thủ công |
| 📋 **Live Logs** | Xem log realtime (nút góc phải dưới màn hình) |
| 🔢 **Threads** | Đặt số account chạy song song (mặc định: 2) |
| 📊 **CPU / RAM** | Hiển thị tài nguyên hệ thống realtime |
| 🏆 **Points** | Hiển thị điểm tích lũy sau mỗi lần chạy |

### Chạy nhiều account theo luồng

1. Tick ✅ các account muốn chạy
2. Đặt số ở ô **Threads** (1–20)
3. Bấm **Run Selected Bots**

Hệ thống sẽ chạy N account cùng lúc, khi 1 account xong tự động lấy account tiếp theo trong hàng đợi.

---

## ⚙️ Các lệnh npm

| Lệnh | Mô tả |
|---|---|
| `npm run build` | Build TypeScript → dist/ (giữ nguyên sessions) |
| `npm run pre-build` | Cài deps + cài Chromium + build |
| `npm run dashboard` | Khởi động Dashboard web |
| `npm run start` | Chạy bot (không dùng dashboard) |
| `npm run clear-sessions` | Xóa toàn bộ sessions |
| `npm run clear-diagnostics` | Xóa diagnostics |
| `npm run kill-chrome-win` | Kill toàn bộ process Chrome (Windows) |

---

## 📁 Cấu trúc thư mục

```
BingReward/
├── src/                    # TypeScript source code
│   ├── index.ts            # Entry point
│   ├── config.json         # Cấu hình (template)
│   ├── accounts.example.json  # Mẫu accounts
│   └── ...
├── scripts/
│   └── main/
│       ├── dashboard.js    # Dashboard server
│       └── dashboard.html  # Dashboard UI
├── dist/                   # Build output (auto-generated)
│   ├── accounts.json       # Danh sách tài khoản thật (không commit)
│   ├── browser/sessions/   # Sessions & fingerprints (không commit)
│   └── ...
├── start-dashboard.bat     # Khởi động nhanh (Windows)
├── package.json
└── README.md
```

---

## 🔐 Bảo mật

> ⚠️ File `dist/accounts.json` chứa **email và mật khẩu thật** — **KHÔNG** commit lên GitHub!

Các file đã được bảo vệ qua `.gitignore`:
- `accounts.json` (root + dist)
- `config.json` (root)
- `dist/browser/` (sessions, fingerprints)
- `dist/account_stats.json`

---

## 🌐 Truy cập từ xa

Dashboard hỗ trợ truy cập từ máy khác trong mạng LAN hoặc qua internet.

**LAN:** Truy cập `http://<IP_máy_chủ>:3000`

**Internet:** Mở port 3000 trên firewall/router, truy cập `http://<IP_public>:3000`

> ⚠️ Hiện tại không có xác thực — nên dùng VPN hoặc đặt phía sau Nginx với Basic Auth nếu expose ra internet.

---

## ❓ Troubleshooting

| Lỗi | Nguyên nhân | Giải pháp |
|---|---|---|
| `EADDRINUSE: port 3000` | Dashboard đang chạy rồi | Đóng process cũ hoặc dùng cổng khác |
| `Mobile flow failed: 400` | API Rewards đổi endpoint | Đã auto-fallback sang HTML parse |
| `No RequestVerificationToken` | Modern Rewards UI | Bình thường, bot vẫn chạy được |
| Session mất sau build | `npm run build` xóa dist | Đã fix — build giữ lại sessions |

---

## 📄 License

GPL-3.0-or-later
