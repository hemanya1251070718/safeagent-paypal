# SafeAgent Ecosystem Launch Script
Write-Host "Starting SafeAgent Ecosystem..." -ForegroundColor Cyan

# 1. P4 Payments & Merkle Ledger (Port 5000)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Write-Host '=== [P4] PAYMENTS & MERKLE LEDGER (Port 5000) ===' -ForegroundColor Green; npm run start:payments"

# 2. P3 Policy Gateway (Port 3000)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Write-Host '=== [P3] POLICY GATEWAY (Port 3000) ===' -ForegroundColor Yellow; npm run start:gateway"

# 3. P2 Cognitive Agent Planner (Port 4001)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Write-Host '=== [P2] COGNITIVE AGENT PLANNER (Port 4001) ===' -ForegroundColor Magenta; npm run start:agent"

# 4. P1 Client Web Console (Port 5173)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Write-Host '=== [P1] CLIENT CONSOLE (Port 5173) ===' -ForegroundColor Cyan; npm run start:client"

Write-Host "`nAll 4 services launched successfully in separate terminal windows!" -ForegroundColor Green
Write-Host "Client Console UI: http://localhost:5173" -ForegroundColor Cyan
