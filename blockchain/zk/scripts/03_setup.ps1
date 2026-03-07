$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")

$ptau = Join-Path $root "ptau\powersOfTau28_hez_final_16.ptau"
$r1cs = Join-Path $root "build\tally.r1cs"

if (!(Test-Path $ptau)) { throw "Missing PTAU: $ptau" }
if (!(Test-Path $r1cs)) { throw "Missing R1CS: $r1cs (run 02_compile.ps1 first)" }

$zkey0 = Join-Path $root "build\tally_0000.zkey"
$zkeyFinal = Join-Path $root "build\tally_final.zkey"
$vkey = Join-Path $root "build\verification_key.json"

# Setup (no contribute)
npx snarkjs groth16 setup $r1cs $ptau $zkey0

# Deterministic finalize with fixed beacon
$beacon = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"
npx snarkjs zkey beacon $zkey0 $zkeyFinal $beacon 10 -n "deterministic-beacon"

# Export vkey
npx snarkjs zkey export verificationkey $zkeyFinal $vkey

Write-Host "OK: created $zkeyFinal and $vkey"
