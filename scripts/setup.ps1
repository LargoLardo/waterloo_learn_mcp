$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

npm install
npx playwright install chromium
npm run build
npm run login

Write-Host "`nSetup complete. Fully restart ChatGPT desktop, then type /mcp."
