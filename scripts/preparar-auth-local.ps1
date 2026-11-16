# Windows-only portable TEST tooling. No installer, OS service or remote project.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolsRoot = Join-Path $projectRoot '.local/tools'
New-Item -ItemType Directory -Force $toolsRoot | Out-Null
function Get-VerifiedArchive($Url, $Name, $Expected) {
    $archivePath = Join-Path $toolsRoot $Name
    if (-not (Test-Path -LiteralPath $archivePath)) { Invoke-WebRequest $Url -OutFile $archivePath }
    if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Expected) { throw "Checksum divergente: $Name" }
    return $archivePath
}
$goArchive = Get-VerifiedArchive 'https://go.dev/dl/go1.27.4.windows-amd64.zip' 'go.zip' '178ab98950ac69ab25069307dc6ade79f3816e414cce95b4da166a115cde1e7e'
$authArchive = Get-VerifiedArchive 'https://github.com/supabase/auth/archive/refs/tags/v2.197.0.zip' 'auth-source.zip' '359a3235b3280e8c8c175559450a07b72249504edc55b266ab9be1776470526b'
$restArchive = Get-VerifiedArchive 'https://github.com/PostgREST/postgrest/releases/download/v14.1/postgrest-v14.1-windows-x86-64.zip' 'postgrest14.zip' '7d34ac6d2c9ba8cb5cb7d169454e24f29be002de913bc12683b1c64f5c789d05'
if (-not (Test-Path (Join-Path $toolsRoot 'go-toolchain/go/bin/go.exe'))) { Expand-Archive -LiteralPath $goArchive -DestinationPath (Join-Path $toolsRoot 'go-toolchain') }
if (-not (Test-Path (Join-Path $toolsRoot 'auth-source/auth-2.197.0'))) { Expand-Archive -LiteralPath $authArchive -DestinationPath (Join-Path $toolsRoot 'auth-source') }
if (-not (Test-Path (Join-Path $toolsRoot 'postgrest14/postgrest.exe'))) { Expand-Archive -LiteralPath $restArchive -DestinationPath (Join-Path $toolsRoot 'postgrest14') }
$authRoot = Join-Path $toolsRoot 'auth-source/auth-2.197.0'
$sourcePath = Join-Path $authRoot 'cmd/serve_cmd.go'
$sourceText = [IO.File]::ReadAllText($sourcePath)
if ($sourceText.Contains('unix.SetsockoptInt')) {
    $beginOffset = $sourceText.IndexOf("`tlc := net.ListenConfig{")
    $endOffset = $sourceText.IndexOf("`tlistener, err := lc.Listen", $beginOffset)
    if ($beginOffset -lt 0 -or $endOffset -lt 0) { throw 'Código de socket diferente do esperado' }
    $sourceText = $sourceText.Substring(0,$beginOffset) + "`t// Local Windows test shim: no Unix SO_REUSEPORT. Authentication is unchanged.`n`tlc := net.ListenConfig{}`n" + $sourceText.Substring($endOffset)
    $sourceText = $sourceText.Replace("`t`"syscall`"`n",'').Replace("`t`"golang.org/x/sys/unix`"`n",'')
    [IO.File]::WriteAllText($sourcePath,$sourceText,[Text.UTF8Encoding]::new($false))
} elseif (-not $sourceText.Contains('Local Windows test shim')) { throw 'Fonte local inesperada' }
$env:GOCACHE = Join-Path $projectRoot '.local/go-cache'
$env:GOMODCACHE = Join-Path $projectRoot '.local/go-modules'
$env:CGO_ENABLED = '0'
Push-Location $authRoot
try {
    & (Join-Path $toolsRoot 'go-toolchain/go/bin/go.exe') build -buildvcs=false -o (Join-Path $toolsRoot 'gotrue.exe') .
    if ($LASTEXITCODE -ne 0) { throw 'Compilação GoTrue falhou' }
} finally { Pop-Location }
Write-Output 'Ferramentas de teste locais preparadas. GoTrue possui somente adaptação de socket para Windows.'
