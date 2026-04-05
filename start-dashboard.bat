@echo off
chcp 65001 >nul
title BingReward Dashboard
color 0A

echo.
echo  +------------------------------------------------------+
echo  ^|              BING REWARDS DASHBOARD                ^|
echo  +------------------------------------------------------+
echo  ^|  Version : 1.0.0 (Patchright Edition)               ^|
echo  ^|  Author  : huynhchinh307                            ^|
echo  ^|  AI Core : Gemini / OpenAI (Compatible)             ^|
echo  +------------------------------------------------------+
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [LOI] Khong tim thay Node.js!
    echo  Vui long cai dat Node.js tu: https://nodejs.org/
    pause
    exit /b 1
)

:: Check if dist/accounts.json exists
if not exist "dist\accounts.json" (
    echo  [CANH BAO] Chua co file accounts.json!
    echo  Dang tao tu mau...
    if not exist "dist" mkdir dist
    copy "src\accounts.example.json" "dist\accounts.json" >nul
    echo  Da tao dist\accounts.json - Vui long dien thong tin tai khoan.
    echo.
)

:: Check if node_modules exists
if not exist "node_modules" (
    echo  [INFO] Chua cai dependencies, dang cai dat...
    call npm install
    echo.
)

:: Check if dist/index.js exists
if not exist "dist\index.js" (
    echo  [INFO] Chua build, dang build du an...
    call npm run build
    echo.
)

echo  [INFO] Khoi dong Dashboard...
echo  [INFO] Truy cap: http://localhost:3000
echo  [INFO] Nhan Ctrl+C de dung
echo.

:: Open browser after 2 seconds
start /b cmd /c "timeout /t 2 >nul && start http://localhost:3000"

:: Start dashboard
npm run dashboard

pause
