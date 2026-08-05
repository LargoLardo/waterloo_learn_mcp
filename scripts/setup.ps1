$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

npm install
npx playwright install chromium
npm run build
npm run login

if (codex mcp list | Select-String '^waterloo-learn-mcp\s') {
  codex mcp remove waterloo-learn-mcp
}
codex mcp add waterloo-learn-mcp -- node (Join-Path $root 'dist/index.js')

Write-Host "`nSetup complete. Fully restart ChatGPT desktop, then type /mcp."
