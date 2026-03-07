$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$build = Join-Path $root "build"
New-Item -ItemType Directory -Force -Path $build | Out-Null

Push-Location $root
circom ".\circuits\tally.circom" --r1cs --wasm --sym -o ".\build"
if ($LASTEXITCODE -ne 0) { throw "circom failed with exit code $LASTEXITCODE" }
Pop-Location

Write-Host "OK: compiled to $build"
