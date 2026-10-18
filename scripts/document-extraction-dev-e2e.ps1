# Development-only browser/worker exercise using the deployed scoped role.
# No role inherits authenticated, bypasses RLS, or receives a service key.
$ErrorActionPreference = 'Stop'
$ref = 'rrhyglrnlveygyiandhs'
$cli = 'C:\Users\AL WAFA\AppData\Local\Temp\supabase-cli-2.117.0\supabase.exe'
$node = 'C:\Users\AL WAFA\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$python = 'C:\Users\AL WAFA\.cache\temo-ocr-benchmark\Scripts\python.exe'
$vite = $null
$worker = $null
$failed = $false

function Invoke-DevSql([string]$sql) {
  $null = & $cli db query --linked --project-ref $ref $sql 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'DOCUMENT_DEV_SQL_FAILED' }
}

try {
  if ((Get-Content 'supabase/.temp/project-ref' -Raw).Trim() -ne $ref) { throw 'DOCUMENT_DEV_LINK_MISMATCH' }
  $role = & $cli db query --linked --project-ref $ref "select rolcanlogin,rolinherit,rolbypassrls from pg_roles where rolname='temo_document_worker'" 2>$null | ConvertFrom-Json
  $identity = $role.rows | Select-Object -First 1
  if (!$identity -or !$identity.rolcanlogin -or $identity.rolinherit -or $identity.rolbypassrls) {
    throw 'DOCUMENT_DEV_SCOPED_WORKER_ROLE_REQUIRED'
  }
  $password = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
  Invoke-DevSql "alter role temo_document_worker password '$password'"
  $downloadSecret = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
  $null = & $cli secrets set --project-ref $ref "TEMO_DOCUMENT_DOWNLOAD_SECRET=$downloadSecret" 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'DOCUMENT_DEV_DOWNLOAD_SECRET_SETUP_FAILED' }

  $keys = & $cli projects api-keys --project-ref $ref --reveal --output json 2>$null | ConvertFrom-Json
  $service = ($keys | Where-Object { $_.name -eq 'service_role' } | Select-Object -First 1).api_key
  $anon = ($keys | Where-Object { $_.name -eq 'anon' } | Select-Object -First 1).api_key
  if (!$service -or !$anon) { throw 'DOCUMENT_DEV_KEYS_UNAVAILABLE' }
  $env:TEMO_ALLOWED_SUPABASE_REF = $ref
  $env:TEMO_WORKER_ENVIRONMENT = 'development'
  $env:TEMO_SUPABASE_URL = "https://$ref.supabase.co"
  $env:TEMO_DOCUMENT_DOWNLOAD_SECRET = $downloadSecret
  $env:TEMO_DOCUMENT_DB_DSN = "postgresql://temo_document_worker:$password@db.$ref.supabase.co:5432/postgres?sslmode=require"
  $env:TEMO_OCR_PROVIDER = 'paddleocr'
  $env:TEMO_OCR_DATASET = "$env:TEMP\temo-ocr-golden-synthetic-1"
  $env:PYTHONIOENCODING = 'utf-8'
  $env:PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK = 'True'
  $env:VITE_SUPABASE_URL = $env:TEMO_SUPABASE_URL
  $env:VITE_SUPABASE_PROJECT_ID = $ref
  $env:VITE_SUPABASE_PUBLISHABLE_KEY = $anon
  $env:VITE_DOCUMENT_ENGINE_ENABLED = 'true'
  $env:VITE_DOCUMENT_WORKER_ENABLED = 'true'

  $vite = Start-Process -FilePath $node -ArgumentList @('node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4174', '--strictPort') -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 3
  $worker = Start-Process -FilePath $python -ArgumentList @('services/document-ocr/worker.py') -PassThru -WindowStyle Hidden
  # Only the controlling Node test receives the Development admin key; neither
  # the Vite process nor the OCR worker inherits it.
  $env:TEMO_SUPABASE_SERVICE_ROLE_KEY = $service
  & $node scripts/document-extraction-dev-e2e.mjs
  if ($LASTEXITCODE -ne 0) { throw 'DOCUMENT_DEV_BROWSER_E2E_FAILED' }
  $worker.Refresh()
  if ($worker.HasExited) { throw 'DOCUMENT_DEV_WORKER_EXITED_EARLY' }
  'Development browser/worker E2E process: PASS'
} catch {
  $failed = $true
  'Development browser/worker E2E: ' + $_.Exception.Message
} finally {
  if ($worker) { $worker.Refresh(); if (!$worker.HasExited) { Stop-Process -Id $worker.Id -Force -ErrorAction SilentlyContinue } }
  if ($vite) { $vite.Refresh(); if (!$vite.HasExited) { Stop-Process -Id $vite.Id -Force -ErrorAction SilentlyContinue } }
  Remove-Item Env:TEMO_ALLOWED_SUPABASE_REF, Env:TEMO_WORKER_ENVIRONMENT, Env:TEMO_SUPABASE_URL,
    Env:TEMO_SUPABASE_SERVICE_ROLE_KEY, Env:TEMO_DOCUMENT_DOWNLOAD_SECRET,
    Env:TEMO_DOCUMENT_DB_DSN, Env:TEMO_OCR_PROVIDER, Env:TEMO_OCR_DATASET,
    Env:VITE_SUPABASE_URL, Env:VITE_SUPABASE_PROJECT_ID, Env:VITE_SUPABASE_PUBLISHABLE_KEY, Env:VITE_DOCUMENT_ENGINE_ENABLED,
    Env:VITE_DOCUMENT_WORKER_ENABLED -ErrorAction SilentlyContinue
  $service = $null; $anon = $null; $password = $null; $downloadSecret = $null
}
if ($failed) { exit 1 }
