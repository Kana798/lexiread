@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js 18 或更高版本。
  pause
  exit /b 1
)

echo 正在打包前端…
node node_modules\vite\bin\vite.js build
if errorlevel 1 goto :failed

echo 正在打包本地服务…
node node_modules\esbuild\bin\esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs
if errorlevel 1 goto :failed

echo.
echo 打包完成。现在可双击“启动阅读器.bat”。
pause
exit /b 0

:failed
echo.
echo [错误] 打包失败，请检查上方输出。
pause
exit /b 1

