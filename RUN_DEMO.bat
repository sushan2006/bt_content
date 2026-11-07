@echo off
title Content Intelligence Platform - Demo
cd /d "%~dp0"
rem This PC has NODE_ENV=production set globally; the local demo needs development mode (http cookies, dev tools).
set NODE_ENV=development
where node >nul 2>nul || (echo Node.js is not installed. Install it from https://nodejs.org and run this again. & pause & exit /b 1)
if not exist node_modules\.bin\tsx.cmd (
  echo Installing dependencies, first run only...
  call npm install --include=dev || (pause & exit /b 1)
)
node scripts\run-demo.mjs
pause
