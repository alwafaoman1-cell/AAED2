# Start the OCR worker for the isolated Development preview on this computer.
# No credential is saved to disk or passed to the shell as a command argument.
$ErrorActionPreference = 'Stop'
$ref = 'rrhyglrnlveygyiandhs'
$cli = 'C:\Users\AL WAFA\AppData\Local\Temp\supabase-cli-2.117.0\supabase.exe'
$python = 'C:\Users\AL WAFA\.cache\temo-ocr-benchmark\Scripts\python.exe'
$projectRoot = Split-Path -Parent $PSScriptRoot

if ((Get-Content (Join-Path $projectRoot 'supabase/.temp/project-ref') -Raw).Trim() -ne $ref) {
  throw 'DOCUMENT_WORKER_DEVELOPMENT_LINK_REQUIRED'
}
if (!(Test-Path -LiteralPath $cli) -or !(Test-Path -LiteralPath $python)) {
  throw 'DOCUMENT_WORKER_RUNTIME_UNAVAILABLE'
}

$roleJson = & $cli db query --linked --project-ref $ref "select rolname, rolbypassrls, rolinherit from pg_roles where rolname='temo_document_worker'" 2>$null | ConvertFrom-Json
$role = $roleJson.rows | Select-Object -First 1
if (!$role -or $role.rolbypassrls -or $role.rolinherit) {
  throw 'DOCUMENT_WORKER_ROLE_SCOPE_INVALID'
}
$policyJson = & $cli db query --linked --project-ref $ref "select count(*)::integer as count from pg_policies where schemaname='public' and policyname like 'document_preview_worker_%' and array_position(roles, 'temo_document_worker'::name) is not null" 2>$null | ConvertFrom-Json
if (($policyJson.rows | Select-Object -First 1).count -ne 5) {
  throw 'DOCUMENT_WORKER_RLS_POLICIES_MISSING'
}
$guardJson = & $cli db query --linked --project-ref $ref "select position('temo_document_worker' in pg_get_functiondef('public.document_worker_write_guard()'::regprocedure)) > 0 as role_guard, has_table_privilege('temo_document_worker','public.document_extraction_pages','SELECT') as page_select" 2>$null | ConvertFrom-Json
$guard = $guardJson.rows | Select-Object -First 1
if (!$guard.role_guard -or !$guard.page_select) {
  throw 'DOCUMENT_WORKER_DATABASE_CONTRACT_MISSING'
}

$existing = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object {
  $_.ExecutablePath -eq $python -and $_.CommandLine -like '*services/document-ocr/worker.py*'
})
if ($existing.Count -gt 0) { throw 'DOCUMENT_WORKER_ALREADY_RUNNING' }

# Rotate the disposable Development role password on each start. Only the
# least-privilege, staging-tenant-scoped role is used for queue SQL.
$password = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$rotationSql = "alter role temo_document_worker password '$password'"
$null = $rotationSql | & $cli db query --linked --project-ref $ref 2>$null
if ($LASTEXITCODE -ne 0) { throw 'DOCUMENT_WORKER_ROLE_ROTATION_FAILED' }

$keys = & $cli projects api-keys --project-ref $ref --reveal --output json 2>$null | ConvertFrom-Json
$serviceKey = ($keys | Where-Object { $_.name -eq 'service_role' } | Select-Object -First 1).api_key
if (!$serviceKey) { throw 'DOCUMENT_WORKER_DEV_STORAGE_KEY_UNAVAILABLE' }

$env:TEMO_ALLOWED_SUPABASE_REF = $ref
$env:TEMO_SUPABASE_URL = "https://$ref.supabase.co"
$env:TEMO_SUPABASE_SERVICE_ROLE_KEY = $serviceKey
$env:TEMO_DOCUMENT_DB_DSN = "postgresql://temo_document_worker:$password@db.$ref.supabase.co:5432/postgres?sslmode=require"
$env:TEMO_OCR_PROVIDER = 'paddleocr'
$env:PYTHONIOENCODING = 'utf-8'
$env:PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK = 'True'
try {
  # Refuse to start a long-running process until the scoped SQL identity works.
  & $python -c 'import os, psycopg; c=psycopg.connect(os.environ["TEMO_DOCUMENT_DB_DSN"]); c.execute("select count(*) from public.document_extractions").fetchone(); c.close()'
  if ($LASTEXITCODE -ne 0) { throw 'DOCUMENT_WORKER_DB_CONNECTION_FAILED' }
  $logBase = Join-Path $env:TEMP ("temo-document-worker-preview-{0}" -f [DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
  $worker = Start-Process -FilePath $python -ArgumentList @('-u', 'services/document-ocr/worker.py') -WorkingDirectory $projectRoot -PassThru -WindowStyle Hidden -RedirectStandardError "$logBase.stderr.log" -RedirectStandardOutput "$logBase.stdout.log"
  Start-Sleep -Seconds 3
  $worker.Refresh()
  if ($worker.HasExited) { throw 'DOCUMENT_WORKER_EXITED_DURING_START' }
  [pscustomobject]@{ project_ref = $ref; worker_pid = $worker.Id; running = $true; stderr_log = "$logBase.stderr.log" }
} finally {
  $env:TEMO_ALLOWED_SUPABASE_REF = $null
  $env:TEMO_SUPABASE_URL = $null
  $env:TEMO_SUPABASE_SERVICE_ROLE_KEY = $null
  $env:TEMO_DOCUMENT_DB_DSN = $null
  $env:TEMO_OCR_PROVIDER = $null
  $env:PYTHONIOENCODING = $null
  $env:PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK = $null
  $password = $null
  $serviceKey = $null
  $keys = $null
  $rotationSql = $null
}
