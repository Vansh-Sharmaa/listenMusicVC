# ListenMusicVC - Share with ngrok (FREE)
# Run this script while your dev servers are running
# It creates two public HTTPS tunnels and gives you a link to share

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  ListenMusicVC - ngrok Share Script  " -ForegroundColor Cyan  
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Check if ngrok is installed
if (-not (Get-Command ngrok -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: ngrok not found. Please install it from https://ngrok.com/download" -ForegroundColor Red
    exit 1
}

# Check if dev servers are running
$serverRunning = Test-NetConnection -ComputerName localhost -Port 3001 -InformationLevel Quiet -WarningAction SilentlyContinue
$clientRunning = Test-NetConnection -ComputerName localhost -Port 3000 -InformationLevel Quiet -WarningAction SilentlyContinue

if (-not $serverRunning) {
    Write-Host "ERROR: Backend server not running on port 3001." -ForegroundColor Red
    Write-Host "Run 'npm run dev' first, then re-run this script." -ForegroundColor Yellow
    exit 1
}

if (-not $clientRunning) {
    Write-Host "ERROR: Frontend not running on port 3000." -ForegroundColor Red
    Write-Host "Run 'npm run dev' first, then re-run this script." -ForegroundColor Yellow
    exit 1
}

Write-Host "Both servers detected!" -ForegroundColor Green
Write-Host ""
Write-Host "Starting ngrok tunnels..." -ForegroundColor Yellow
Write-Host "(You need a free ngrok account. Sign up at https://ngrok.com if you haven't)" -ForegroundColor Gray
Write-Host ""

# Start backend tunnel in background
Write-Host "Tunneling backend (port 3001)..." -ForegroundColor Cyan
$backendJob = Start-Job -ScriptBlock { ngrok http 3001 --log=stdout } 
Start-Sleep -Seconds 5

# Get the backend public URL from ngrok API
try {
    $ngrokApi = Invoke-RestMethod -Uri "http://localhost:4040/api/tunnels" -ErrorAction Stop
    $backendUrl = ($ngrokApi.tunnels | Where-Object { $_.config.addr -like "*3001*" } | Select-Object -First 1).public_url
    if (-not $backendUrl) {
        $backendUrl = $ngrokApi.tunnels[0].public_url
    }
} catch {
    Write-Host "ERROR: Could not get ngrok tunnel info. Make sure ngrok is authenticated." -ForegroundColor Red
    Write-Host "Run: ngrok config add-authtoken YOUR_TOKEN" -ForegroundColor Yellow
    Write-Host "Get your token at: https://dashboard.ngrok.com/get-started/your-authtoken" -ForegroundColor Yellow
    Stop-Job $backendJob
    exit 1
}

# Force HTTPS
$backendUrl = $backendUrl -replace "^http:", "https:"

Write-Host "Backend URL: $backendUrl" -ForegroundColor Green
Write-Host ""

# Update .env.local with the backend URL
$envContent = "NEXT_PUBLIC_SERVER_URL=$backendUrl"
$envPath = Join-Path $PSScriptRoot "client\.env.local"
Set-Content -Path $envPath -Value $envContent
Write-Host "Updated client/.env.local with backend URL" -ForegroundColor Green

Write-Host ""
Write-Host "NOTE: The frontend needs to be RESTARTED to pick up the new backend URL." -ForegroundColor Yellow
Write-Host "1. Stop your 'npm run dev' (Ctrl+C)" -ForegroundColor White
Write-Host "2. Run 'npm run dev' again" -ForegroundColor White
Write-Host "3. Then run this script again" -ForegroundColor White
Write-Host ""
Write-Host "After restart, open a new terminal and run:" -ForegroundColor Cyan
Write-Host "  ngrok http 3000" -ForegroundColor White
Write-Host ""
Write-Host "Then send the ngrok FRONTEND URL to her!" -ForegroundColor Magenta
Write-Host ""

Stop-Job $backendJob
