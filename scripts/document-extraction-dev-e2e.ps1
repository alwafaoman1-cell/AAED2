# Development-only disposable browser/worker exercise. Never print credentials.
# The temporary role inherits authenticated and bypasses RLS solely for this
# synthetic test; never reuse this role/grant pattern for a deployed worker.
$ErrorActionPreference = 'Stop'
$ref = 'rrhyglrnlveygyiandhs'
$cli = 'C:\Users\AL WAFA\AppData\Local\Temp\supabase-cli-2.117.0\supabase.exe'
$node = 'C:\Users\AL WAFA\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$python = 'C:\Users\AL WAFA\.cache\temo-ocr-benchmark\Scripts\python.exe'
$created = $false
$vite = $null
$worker = $null
$failed = $false

function Invoke-DevSql([string]$sql) {
  $null = & $cli db query --linked --project-ref $ref $sql 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'DOCUMENT_DEV_SQL_FAILED' }
}

try {
  if ((Get-Content 'supabase/.temp/project-ref' -Raw).Trim() -ne $ref) { throw 'DOCUMENT_DEV_LINK_MISMATCH' }
  $bytes = [byte[]]::new(24)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $password = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', 'A').Replace('/', 'B')
  Invoke-DevSql "create role temo_document_worker login inherit bypassrls password '$password'"
  $created = $true
  Invoke-DevSql 'grant authenticated to temo_document_worker'
  Invoke-DevSql 'grant connect on database postgres to temo_document_worker'
  Invoke-DevSql 'grant usage on schema public to temo_document_worker'
  Invoke-DevSql 'grant select, insert, update, delete on public.document_files, public.document_extractions, public.document_extraction_pages, public.document_extraction_fields, public.document_extraction_events to temo_document_worker'

  $keys = & $cli projects api-keys --project-ref $ref --reveal --output json 2>$null | ConvertFrom-Json
  $service = ($keys | Where-Object { $_.name -eq 'service_role' } | Select-Object -First 1).api_key
  $anon = ($keys | Where-Object { $_.name -eq 'anon' } | Select-Object -First 1).api_key
  if (!$service -or !$anon) { throw 'DOCUMENT_DEV_KEYS_UNAVAILABLE' }
  $env:TEMO_ALLOWED_SUPABASE_REF = $ref
  $env:TEMO_SUPABASE_URL = "https://$ref.supabase.co"
  $env:TEMO_SUPABASE_SERVICE_ROLE_KEY = $service
  $env:TEMO_DOCUMENT_DB_DSN = "postgresql://temo_document_worker:$password@db.$ref.supabase.co:5432/postgres?sslmode=require"
  $env:TEMO_OCR_PROVIDER = 'paddleocr'
  $env:TEMO_OCR_DATASET = "$env:TEMP\temo-ocr-golden-synthetic-1"
  $env:TEMO_WORKER_ONCE = '1'
  $env:TEMO_WORKER_TEST_MAX_JOBS = '3'
  $env:PYTHONIOENCODING = 'utf-8'
  $env:PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK = 'True'
  $env:VITE_SUPABASE_URL = $env:TEMO_SUPABASE_URL
  $env:VITE_SUPABASE_PUBLISHABLE_KEY = $anon
  $env:VITE_DOCUMENT_ENGINE_ENABLED = 'true'
  $env:VITE_DOCUMENT_WORKER_ENABLED = 'true'

  $vite = Start-Process -FilePath $node -ArgumentList @('node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4174', '--strictPort') -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 3
  $worker = Start-Process -FilePath $python -ArgumentList @('services/document-ocr/worker.py') -PassThru -WindowStyle Hidden
  & $node scripts/document-extraction-dev-e2e.mjs
  if ($LASTEXITCODE -ne 0) { throw 'DOCUMENT_DEV_BROWSER_E2E_FAILED' }
  Wait-Process -Id $worker.Id -Timeout 25 -ErrorAction SilentlyContinue
  $worker.Refresh()
  if (!$worker.HasExited -or $worker.ExitCode -ne 0) { throw 'DOCUMENT_DEV_WORKER_EXIT_FAILED' }
  'Development browser/worker E2E process: PASS'
} catch {
  $failed = $true
  'Development browser/worker E2E: ' + $_.Exception.Message
} finally {
  if ($worker) { $worker.Refresh(); if (!$worker.HasExited) { Stop-Process -Id $worker.Id -Force -ErrorAction SilentlyContinue } }
  if ($vite) { $vite.Refresh(); if (!$vite.HasExited) { Stop-Process -Id $vite.Id -Force -ErrorAction SilentlyContinue } }
  Remove-Item Env:TEMO_ALLOWED_SUPABASE_REF, Env:TEMO_SUPABASE_URL, Env:TEMO_SUPABASE_SERVICE_ROLE_KEY,
    Env:TEMO_DOCUMENT_DB_DSN, Env:TEMO_OCR_PROVIDER, Env:TEMO_OCR_DATASET, Env:TEMO_WORKER_ONCE,
    Env:TEMO_WORKER_TEST_MAX_JOBS,
    Env:VITE_SUPABASE_URL, Env:VITE_SUPABASE_PUBLISHABLE_KEY, Env:VITE_DOCUMENT_ENGINE_ENABLED,
    Env:VITE_DOCUMENT_WORKER_ENABLED -ErrorAction SilentlyContinue
  $service = $null; $anon = $null; $password = $null
  if ($created) {
    try {
      Invoke-DevSql 'revoke select, insert, update, delete on public.document_files, public.document_extractions, public.document_extraction_pages, public.document_extraction_fields, public.document_extraction_events from temo_document_worker'
      Invoke-DevSql 'revoke usage on schema public from temo_document_worker'
      Invoke-DevSql 'revoke connect on database postgres from temo_document_worker'
      Invoke-DevSql 'revoke authenticated from temo_document_worker'
      Invoke-DevSql 'drop role temo_document_worker'
      'Temporary Development worker role removed'
    } catch {
      $failed = $true
      'Temporary Development worker role cleanup needs review'
    }
  }
}
if ($failed) { exit 1 }
