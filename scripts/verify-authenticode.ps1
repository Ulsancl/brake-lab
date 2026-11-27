param([Parameter(Mandatory = $true)][string] $Path)
$ErrorActionPreference = 'Stop'
$expected = $env:BRAKE_RELEASE_SIGNER_SHA256
if ($expected -notmatch '\A[0-9a-fA-F]{64}\z') {
  throw 'Set BRAKE_RELEASE_SIGNER_SHA256 to the trusted release certificate fingerprint.'
}
$signature = Get-AuthenticodeSignature -LiteralPath $Path
if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate) {
  throw "Authenticode verification failed ($($signature.Status)): $Path"
}
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
  $actual = [BitConverter]::ToString($sha256.ComputeHash($signature.SignerCertificate.RawData)).Replace('-', '')
} finally {
  $sha256.Dispose()
}
if ($actual -ine $expected) { throw "Unexpected Authenticode signer: $Path" }
if (-not $signature.TimeStamperCertificate) { throw "Missing Authenticode timestamp: $Path" }
Write-Output "Verified Authenticode signer and timestamp for $Path"
