# Starts the video analyzer and the API (which also serves the built dashboard) in two windows.
# Usage (PowerShell, from the project folder):  .\scripts\start-windows.ps1
$root = Split-Path -Parent $PSScriptRoot
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\services\analyzer'; .\.venv\Scripts\Activate.ps1; uvicorn app:app --port 8001"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root'; npm run dev:api"
Start-Sleep -Seconds 6
Start-Process "http://localhost:4000"
