@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [错误] 未检测到 Node.js。
  echo 请安装 Node.js 18 或更高版本后重试：https://nodejs.org/
  pause
  exit /b 1
)

if not exist "dist\server.cjs" (
  echo.
  echo [错误] 未找到生产构建文件 dist\server.cjs。
  echo 请先在项目目录运行“重新打包.bat”。
  pause
  exit /b 1
)

set NODE_ENV=production
start "LexiRead" http://localhost:3000
echo LexiRead 已启动： http://localhost:3000
echo 关闭此窗口即可停止本地服务。
node dist\server.cjs

