# Run the synthetic queue smoke without persisting Development keys locally.
$ErrorActionPreference = 'Stop'
$ref = 'rrhyglrnlveygyiandhs'
$projectRoot = Split-Path -Parent $PSScriptRoot
if ((Get-Content (Join-Path $projectRoot 'supabase/.temp/project-ref') -Raw).Trim() -ne $ref) {
  throw 'DOCUMENT_SMOKE_DEVELOPMENT_LINK_REQUIRED'
}
$cli = 'C:\Users\AL WAFA\AppData\Local\Temp\supabase-cli-2.117.0\supabase.exe'
$node = 'C:\Users\AL WAFA\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$keys = & $cli projects api-keys --project-ref $ref --reveal --output json 2>$null | ConvertFrom-Json
$service = ($keys | Where-Object { $_.name -eq 'service_role' } | Select-Object -First 1).api_key
$anon = ($keys | Where-Object { $_.name -eq 'anon' } | Select-Object -First 1).api_key
if (!$service -or !$anon) { throw 'DOCUMENT_SMOKE_DEV_KEYS_UNAVAILABLE' }
$env:TEMO_SUPABASE_URL = "https://$ref.supabase.co"
$env:TEMO_SUPABASE_SERVICE_ROLE_KEY = $service
$env:TEMO_SUPABASE_ANON_KEY = $anon
try {
  & $node (Join-Path $PSScriptRoot 'document-worker-preview-smoke.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'DOCUMENT_WORKER_PREVIEW_SMOKE_FAILED' }
} finally {
  $env:TEMO_SUPABASE_URL = $null
  $env:TEMO_SUPABASE_SERVICE_ROLE_KEY = $null
  $env:TEMO_SUPABASE_ANON_KEY = $null
  $service = $null
  $anon = $null
  $keys = $null
}
