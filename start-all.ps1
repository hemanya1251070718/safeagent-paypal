# SafeAgent Unified Multi-Service Launch Script
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  [*] Launching SafeAgent Full Stack Console (4 Services)  " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$baseDir = $PSScriptRoot

# 1. Start Policy Gateway (P3) on Port 3000
Write-Host "[1/4] Starting Policy Gateway (Port 3000)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$baseDir\gateway'; npm run dev"

# 2. Start Payments & Telemetry (P4) on Port 5000
Write-Host "[2/4] Starting Payments & Telemetry Service (Port 5000)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$baseDir\payments'; npm run dev"

# 3. Start Cognitive Agent (P2) on Port 4001
Write-Host "[3/4] Starting Cognitive Agent (Port 4001)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$baseDir\agent'; npm run dev"

# 4. Start React Frontend (P1) on Port 5173
Write-Host "[4/4] Starting React & AG Grid Frontend (Port 5173)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$baseDir\client'; npm run dev"

Start-Sleep -Seconds 3

Write-Host ""
Write-Host "[SUCCESS] All 4 services launched in separate windows!" -ForegroundColor Green
Write-Host "Opening SafeAgent Operating Console at: http://localhost:5173" -ForegroundColor Cyan
Start-Process "http://localhost:5173"
