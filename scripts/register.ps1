$ErrorActionPreference = 'Stop'

$serverName = 'waterloo-learn-mcp'
$root = Split-Path -Parent $PSScriptRoot
$entryPoint = [IO.Path]::GetFullPath((Join-Path $root 'dist\index.js'))

function Resolve-RegistrationPath([string]$value) {
  if ([IO.Path]::IsPathRooted($value)) {
    return [IO.Path]::GetFullPath($value)
  }
  return [IO.Path]::GetFullPath((Join-Path $root $value))
}

if (-not (Test-Path -LiteralPath $entryPoint -PathType Leaf)) {
  throw "Built MCP entry point not found at $entryPoint. Run npm run build first."
}

$savedErrorActionPreference = $ErrorActionPreference
try {
  # Windows PowerShell wraps native stderr as ErrorRecord objects. A missing
  # server is an expected probe result, so capture it without terminating.
  $ErrorActionPreference = 'Continue'
  $getOutput = & codex mcp get $serverName --json 2>&1
  $getExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $savedErrorActionPreference
}

if ($getExitCode -eq 0) {
  $existing = ($getOutput | Out-String) | ConvertFrom-Json
  $transport = $existing.transport
  $commandName = [IO.Path]::GetFileName([string]$transport.command).ToLowerInvariant()
  $args = @($transport.args)
  $registeredEntryPoint = if ($args.Count -eq 1) {
    Resolve-RegistrationPath ([string]$args[0])
  } else {
    $null
  }

  if (
    $transport.type -eq 'stdio' -and
    $commandName -in @('node', 'node.exe') -and
    $registeredEntryPoint -eq $entryPoint
  ) {
    Write-Host "$serverName is already registered correctly."
    exit 0
  }

  throw (
    "$serverName is already registered with a different command. " +
    "Refusing to remove it automatically. Inspect it with " +
    "'codex mcp get $serverName --json' before replacing it."
  )
}

$getError = ($getOutput | Out-String).Trim()
if ($getError -notmatch "No MCP server named '$([regex]::Escape($serverName))' found") {
  throw "Could not inspect the Codex MCP configuration: $getError"
}

Write-Host "$serverName is missing; restoring its registration..."
& codex mcp add $serverName -- node $entryPoint
if ($LASTEXITCODE -ne 0) {
  throw "Failed to register $serverName."
}

# Verify the write so a partially failed Codex config update is never reported
# as a successful repair.
$verifyOutput = & codex mcp get $serverName --json 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Codex did not retain the new $serverName registration: $($verifyOutput | Out-String)"
}

$verified = ($verifyOutput | Out-String) | ConvertFrom-Json
$verifiedArgs = @($verified.transport.args)
$verifiedEntryPoint = if ($verifiedArgs.Count -eq 1) {
  Resolve-RegistrationPath ([string]$verifiedArgs[0])
} else {
  $null
}

if (
  $verified.transport.type -ne 'stdio' -or
  [IO.Path]::GetFileName([string]$verified.transport.command).ToLowerInvariant() -notin @('node', 'node.exe') -or
  $verifiedEntryPoint -ne $entryPoint
) {
  throw "Codex saved an unexpected $serverName registration. Inspect it with 'codex mcp get $serverName --json'."
}

Write-Host "$serverName registration restored. Fully restart ChatGPT/Codex once to load it."
