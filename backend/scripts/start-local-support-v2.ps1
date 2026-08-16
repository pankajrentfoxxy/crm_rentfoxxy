# Local Support-v2 stack (Docker Postgres on 5433). Does not touch Railway.
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = '5433'
$env:DB_USER = 'postgres'
$env:DB_PASSWORD = 'password123'
$env:DB_NAME = 'rentfoxxy_crm_local'
$env:DB_SSL = 'false'
$env:DATABASE_URL = 'postgresql://postgres:password123@127.0.0.1:5433/rentfoxxy_crm_local'
$env:PORT = '5001'
$env:ENABLE_BACKGROUND_WORKERS = 'true'
Set-Location $PSScriptRoot\..
npm run dev
