# TCK-19 verification: register/login/logout/me + validation + 401s + rate limit
$fail = 0; function Check($name, $cond) { if ($cond) { Write-Host "PASS  $name" } else { Write-Host "FAIL  $name"; $script:fail++ } };
$base = "http://localhost:3210"
$jar = Join-Path $env:TEMP "sus-jar.txt"
$bf = Join-Path $env:TEMP "sus-body.json"
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

# 1. validation errors
$r = Post "/api/auth/register" '{"username":"ab","email":"not-an-email","password":"short"}' $null $null
Check "weak registration -> 400 invalid_registration" ($r.status -eq 400 -and $r.body.code -eq "invalid_registration")

# 2. valid registration -> 201 + user + cookie
$r = Post "/api/auth/register" '{"username":"alex","email":"alex@test.local","password":"sus12345"}' $jar $null
$b = $r.body
Check "register alex -> 201 + user JSON" ($r.status -eq 201 -and $b.user.username -eq "alex" -and $b.user.email -eq "alex@test.local" -and $b.user.ownerKey)
Check "register sets session cookie" ($r.raw -match "set-cookie: sus_session=")

# 3. duplicates
$r = Post "/api/auth/register" '{"username":"alex","email":"other@test.local","password":"sus12345"}' $null $null
Check "duplicate username -> 409" ($r.status -eq 409 -and $r.body.code -eq "duplicate_username")
$r = Post "/api/auth/register" '{"username":"other","email":"ALEX@Test.local","password":"sus12345"}' $null $null
Check "duplicate email (case-insensitive) -> 409" ($r.status -eq 409 -and $r.body.code -eq "duplicate_email")

# 4. me with + without cookie
$me = curl.exe -s -w "`n%{http_code}" -b $jar "$base/api/auth/me"; $ml = $me -split "`n"
$meBody = (($ml[0..($ml.Length - 2)]) -join "`n") | ConvertFrom-Json
Check "me with cookie -> 200 alex" (($ml[-1]) -eq "200" -and $meBody.user.username -eq "alex")
Check "me JSON has no password hash" (($me -join "`n") -notmatch "password|s1:")
$meAnon = curl.exe -s -o NUL -w "%{http_code}" "$base/api/auth/me"
Check "me without cookie -> 401" ($meAnon -eq "401")

# 5. logout kills session server-side
$lo = curl.exe -s -c $jar -b $jar -o NUL -w "%{http_code}" -X POST "$base/api/auth/logout"
Check "logout -> 200" ($lo -eq "200")
$meAfter = curl.exe -s -o NUL -w "%{http_code}" -b $jar "$base/api/auth/me"
Check "me after logout -> 401 (session dead server-side)" ($meAfter -eq "401")

# 6. login wrong + right (by email)
$r = Post "/api/auth/login" '{"identifier":"alex@test.local","password":"wrongpass1"}' $null $null
Check "login wrong password -> 401" ($r.status -eq 401 -and $r.body.code -eq "invalid_credentials")
$r = Post "/api/auth/login" '{"identifier":"alex@test.local","password":"sus12345"}' $jar $null
$b = $r.body
Check "login by email -> 200 + cookie" ($r.status -eq 200 -and $b.user.username -eq "alex")

# 7. create requires login
$anonCreate = curl.exe -s -o NUL -w "%{http_code}" -X POST "$base/api/links" -H "Content-Type: application/json" --data-binary '{"url":"https://example.com/anon","slug":"AnonLink"}'
Check "anonymous create -> 401" ($anonCreate -eq "401")
Set-Content -Path $bf -Value '{"url":"https://example.com/owned","slug":"OwnedLink","mode":"redirect"}' -NoNewline -Encoding ASCII
$cr = curl.exe -s -o NUL -w "%{http_code}" -b $jar -X POST "$base/api/links" -H "Content-Type: application/json" --data-binary "@$bf"
Check "logged-in create -> 201" ($cr -eq "201")

# 8. login rate limit: hammer until 429 (limit 30/10min)
$hit429 = $false
for ($i = 0; $i -lt 40; $i++) {
  $code = curl.exe -s -o NUL -w "%{http_code}" -X POST "$base/api/auth/login" -H "Content-Type: application/json" --data-binary '{"identifier":"nobody","password":"nope1234"}'
  if ($code -eq "429") { $hit429 = $true; break }
}
Check "auth rate limiter fires 429" ($hit429 -eq $true)
Remove-Item $jar, $bf -ErrorAction SilentlyContinue
Write-Host "=== failures: $fail ==="
