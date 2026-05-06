# So sánh luồng xử lý: `registerAccount.js` vs `AccountCreator.ts`

> **Nguồn tham khảo:** https://git.justw.tf/LightZirconite/Microsoft-Rewards-Bot/raw/branch/legacy/src/account-creation/AccountCreator.ts

---

## 1. Kiến trúc tổng thể

| Khía cạnh | `registerAccount.js` (Local) | `AccountCreator.ts` (Remote) |
|-----------|------------------------------|-------------------------------|
| **Ngôn ngữ** | JavaScript (ES Module) | TypeScript (Class-based) |
| **Cấu trúc** | Hàm `main()` monolithic | Class `AccountCreator` với nhiều private methods |
| **Email source** | API thuê gmail (shopgmail9999.com) | Tự tạo email Outlook/Hotmail |
| **Password flow** | Nhập mật khẩu ngay từ đầu | Tạo mật khẩu sau (Add Password page) |
| **CAPTCHA** | Tự động giải Arkose Press & Hold | Chờ user giải thủ công |
| **Human behavior** | `humanType()`, `fluentUIClick()` cơ bản | `HumanBehavior` class với `microGestures()`, `secureRandom()` |
| **Retry logic** | Không có (hoặc rất ít) | `retryOperation()` với human-like delays |
| **2FA/Recovery** | Không có | `setup2FA()`, `setupRecoveryEmail()` sau khi tạo xong |

---

## 2. Luồng xử lý chi tiết

### Local (`registerAccount.js`)

```
1. Rotate proxy
2. Tạo OTP order (shopgmail9999.com)  ← Email thuê ngoài
3. Launch browser (Patchright)
4. Navigate: signup.live.com/signup
5. Nhập email (từ OTP order)
6. Poll OTP (max 5 phút)
7. Nhập OTP code
8. Nhập ngày sinh (dropdown tĩnh)
9. Nhập tên (random VN/EN)
10. Click Next
11. Xử lý CAPTCHA (Arkose tự động + thủ công)
12. Vòng lặp finalization:
    - Privacy Notice → OK
    - Passkey prompt → Refuse
    - Stay Signed In → Yes
    - Check URL (account.microsoft.com / rewards.bing.com)
13. Navigate tới change password page → đặt mật khẩu
14. Activate Rewards qua referral link
15. Chờ & lưu session
```

### Remote (`AccountCreator.ts`)

```
1. Navigate: rewards.bing.com (referral) hoặc login.live.com
2. Xử lý cookie banner (reject)
3. Click "Create account" / "Join"
4. generateAndFillEmail() → tạo email Outlook/Hotmail
5. fillPassword() → tạo mật khẩu
6. extractEmail() → xác nhận email từ identity badge
7. fillBirthdate() với layout detection (Month/Day order)
8. fillNames()
9. waitForCaptcha() → chờ user giải thủ công
10. handlePostCreationQuestions():
    - handlePasskeyPrompt() ← hàm riêng
    - KMSI (Stay signed in)
    - Biometric prompts
11. verifyAccountActive() → navigate rewards.bing.com
12. dismissCookieBanner()
13. handleGetStartedPopup()
14. setupRecoveryEmail() (tùy chọn)
15. setup2FA() (tùy chọn)
16. saveAccount()
```

---

## 3. Điểm khác biệt quan trọng

### 3.1 Passkey Handling ⚠️

| | Local (cũ) | Local (đã sửa) | Remote |
|--|-----------|----------------|--------|
| **Cấu trúc** | Inline trong loop | Hàm `handlePasskeyPrompt()` riêng | Method `handlePasskeyPrompt()` riêng |
| **Detection selectors** | Trộn lẫn với refuse selectors → **false positive** | Tách riêng, chỉ passkey-specific | Tách riêng |
| **Chờ page stable** | Không | Không | `waitForPageStable("PASSKEY_CHECK", 15000)` |
| **Logging** | Cơ bản | Log selector nào triggered | Log đầy đủ |

### 3.2 Birthdate - Phát hiện layout

Remote có logic phát hiện **Month-first vs Day-first layout** dựa trên tọa độ DOM:

```typescript
// Remote: kiểm tra vị trí X/Y của dropdown để xác định thứ tự
const monthX = monthBox?.x ?? 0;
const dayX = dayBox?.x ?? 0;
const sameLine = Math.abs(monthY - dayY) < 10;
monthBeforeDay = sameLine ? monthX < dayX : monthY < dayY;
```

```javascript
// Local: luôn điền Month → Day → Year (cứng)
await fluentUIClick(page, '#BirthMonthDropdown')
await fluentUIClick(page, '#BirthDayDropdown')
await humanType(page, 'input[name="BirthYear"]', year)
```

**→ Nếu Microsoft đổi thứ tự dropdown, local sẽ nhập sai.**

### 3.3 Error Detection

Remote có `verifyNoErrors()` kiểm tra sau mỗi bước:
- `div[role="alert"]`
- `[aria-invalid="true"]`
- Rate limit detection: `"We can't create your account"`
- Temporary unavailability: `"site is temporarily unavailable"`

**Local không có** → Bot có thể tiếp tục ngay cả khi có lỗi form.

### 3.4 Account Creation Wait

Remote theo dõi Microsoft đang tạo tài khoản:
```typescript
// Chờ "Login" message xuất hiện rồi biến mất
await element.waitFor({ state: 'hidden', timeout: 60000 })
// Chờ URL ổn định 3 lần liên tiếp
if (urlStableCount >= 3) break
```

**Local:** dùng `await page.waitForTimeout(3000)` đơn giản.

### 3.5 Human Behavior

| Feature | Local | Remote |
|---------|-------|--------|
| Typing delay | Random 100-250ms/char | `humanType()` với `HumanBehavior` class |
| Mouse movement | Không | `microGestures()` |
| Random gestures | Không | 30-70% xác suất gesture giữa các bước |
| Retry delay | Cố định | `secureRandom()` + jitter ±500ms |

### 3.6 Email Strategy

| | Local | Remote |
|--|-------|--------|
| Email | Thuê qua API (shopgmail9999.com) | Tạo mới Outlook/Hotmail |
| Chi phí | Tốn tiền mỗi lần | Miễn phí |
| Độ tin cậy | Phụ thuộc API bên thứ 3 | Tự kiểm soát |
| Account age | Mới hoàn toàn (gmail) | Outlook domain uy tín hơn |

---

## 4. Đề xuất cải thiện cho Local

### Ưu tiên cao
- [ ] **Thêm `verifyNoErrors()`** sau mỗi bước nhập liệu
- [ ] **Birthdate layout detection** — kiểm tra X/Y tọa độ thay vì hard-code thứ tự
- [ ] **Rate limit detection** — dừng sớm nếu Microsoft block

### Ưu tiên trung bình
- [ ] **Account creation wait** — theo dõi "Login" message thay vì `waitForTimeout`
- [ ] **Retry logic** với human-like delays cho các thao tác quan trọng
- [ ] **Thêm selector tiếng Pháp** cho passkey (nếu proxy EU)

### Ưu tiên thấp
- [ ] `microGestures()` / random mouse movement
- [ ] Setup 2FA sau khi tạo tài khoản
- [ ] Recovery email setup

---

## 5. Những gì Local làm TỐT HƠN Remote

- **CAPTCHA tự động** (Arkose Press & Hold) — Remote phải chờ user giải thủ công
- **Proxy rotation** tích hợp sẵn
- **OTP email từ API** — nhanh hơn tạo email Outlook
- **Session persistence** định kỳ mỗi 10 giây
- **Tên tiếng Việt** phong phú (300+ names)
- **Tích hợp với hệ thống hiện có** (rewards_data.db, dashboard...)
