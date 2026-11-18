# TCK-32..35 verification: forgot/reset password flow (dual-mode).
# Works whether the mailer is configured (real Brevo email) or not (dev link
# in the response). Real mode mints a known token straight into the DB for
# the reset-endpoint checks. Tear-down kills node -> dev-server job ends
# with exit code 1 (harmless).
$fail = 0; function Check($name, $cond) { if ($cond) { Write-Host "PASS  $name" } else { Write-Host "FAIL  $name"; $script:fail++ } };
$base = "http://localhost:3210"
$jar = Join-Path $env:TEMP "sus-forgot-jar.txt"
$bf = Join-Path $env:TEMP "sus-forgot-body.json"
Remove-Item $jar -ErrorAction SilentlyContinue

function Post([string]$path, [string]$bodyJson, [string]$jarSave, [string]$jarSend) {
  Set-Content -Path $bf -Value $bodyJson -NoNewline -Encoding ASCII
  $argsList = @("-s", "-w", "`n%{http_code}", "-X", "POST", "$base$path", "-H", "Content-Type: application/json", "--data-binary", "@$bf")
  if ($jarSave) { $argsList += @("-c", $jarSave) }
  if ($jarSend) { $argsList += @("-b", $jarSend) }
  $out = curl.exe @argsList
  $lines = $out -split "`n"
  [pscustomobject]@{ status = [int]$lines[-1]; body = (($lines[0..($lines.Length - 2)]) -join "`n") | ConvertFrom-Json; raw = $out }
}

# 1. generic responses - nothing to learn from the endpoint
$r = Post "/api/auth/forgot-password" '{"email":"nobody@nowhere.zz"}' $null $null
Check "unknown email -> 200 generic ok" ($r.status -eq 200 -and $r.body.ok -eq $true -and $r.body.message)
Check "unknown email response has no devLink and no account hint" ($r.raw -notmatch "devLink" -and $r.body.message -match "If that email")
$r = Post "/api/auth/forgot-password" '{"email":"garbage"}' $null $null
Check "malformed email -> 200 generic (no enumeration)" ($r.status -eq 200 -and $r.body.ok -eq $true)

# 2. request for a real account
$r = Post "/api/auth/forgot-password" '{"email":"alex@test.local"}' $null $null
Check "known account -> 200 generic ok" ($r.status -eq 200 -and $r.body.ok -eq $true)
$devLink = $r.body.devLink
$mode = if ($devLink) { "dev" } else { "real" }
Write-Host "mode: $mode mailer"

# 3. obtain a raw token
if ($mode -eq "dev") {
  $token = ($devLink -split 'token=')[1]
} else {
  # Real mailer: mint a known token straight into the local DB via the
  # app's own store functions (same hashing + 1h expiry the route uses).
  $token = "fcef" + [guid]::NewGuid().ToString("N") + "a17b"
  $prev = Get-Location
  Set-Location C:\KuromiLab\sus-url-shortener
  $out = node -e "import('file:///C:/KuromiLab/sus-url-shortener/lib/store.js').then(async (s) => { const { hashToken } = await import('file:///C:/KuromiLab/sus-url-shortener/lib/auth.js'); await s.passwordResetTokenInsert(hashToken(process.argv[1]), (await s.userByEmail('alex@test.local')).id, new Date(Date.now() + 3600000).toISOString()); console.log('inserted'); })" $token
  Set-Location $prev
  Check "real mode: token minted via store" ($out -match "inserted")
}

# 4. weak password rejected
$r = Post "/api/auth/reset-password" ('{"token":"' + $token + '","password":"short"}') $null $null
Check "weak new password -> 400 weak_password" ($r.status -eq 400 -and $r.body.code -eq "weak_password")

# 5. good reset -> 200
$r = Post "/api/auth/reset-password" ('{"token":"' + $token + '","password":"freshPass99"}') $null $null
Check "valid reset -> 200 ok" ($r.status -eq 200 -and $r.body.ok -eq $true)

# 6. token reuse rejected (single-use)
$r = Post "/api/auth/reset-password" ('{"token":"' + $token + '","password":"anotherPass77"}') $null $null
Check "token reuse -> 400 invalid_token" ($r.status -eq 400 -and $r.body.code -eq "invalid_token")

# 7. old password dead, new password works
$r = Post "/api/auth/login" '{"identifier":"alex@test.local","password":"sus12345"}' $null $null
Check "old password -> 401" ($r.status -eq 401 -and $r.body.code -eq "invalid_credentials")
$r = Post "/api/auth/login" '{"identifier":"alex@test.local","password":"freshPass99"}' $jar $null
Check "new password -> 200 + cookie" ($r.status -eq 200 -and $r.body.user.username -eq "alex")

# 8. garbage token -> generic invalid
$r = Post "/api/auth/reset-password" '{"token":"deadbeef","password":"whatever123"}' $null $null
Check "garbage token -> 400 invalid_token" ($r.status -eq 400 -and $r.body.code -eq "invalid_token")

# 9. pages render
foreach ($p in @("/forgot-password", "/reset-password?token=abc", "/login")) {
  $code = curl.exe -s -o NUL -w "%{http_code}" "$base$p"
  Check "GET $p -> 200" ($code -eq "200")
}
$loginHtml = curl.exe -s "$base/login"
Check "login page links forgot-password" ($loginHtml -match "forgot-password")

Write-Host ""
if ($fail -eq 0) { Write-Host "ALL PASS" } else { Write-Host "$fail FAIL" }
