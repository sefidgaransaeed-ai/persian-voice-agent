# سرور ایستای کوچک برای اجرای محلی اپ.
#
# چرا لازم است: مرورگرها روی نشانی file:// اجازهٔ دسترسی به میکروفون نمی‌دهند،
# پس گفتار زنده با دابل‌کلیک روی index.html کار نمی‌کند. این اسکریپت پوشه را
# روی http://localhost سرو می‌کند تا میکروفون فعال شود.
#
# چرا TcpListener و نه HttpListener: HttpListener برای رزرو نشانی به دسترسی
# مدیر یا netsh urlacl نیاز دارد. TcpListener روی لوپ‌بک بدون هیچ دسترسی ویژه‌ای کار می‌کند.
#
# اجرا:  powershell -ExecutionPolicy Bypass -File serve.ps1

param(
  [int]$Port = 8787,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# همان مسیری که voicetype.ps1 می‌خواند — باید یکی بماند
$dataDir = Join-Path $env:LOCALAPPDATA 'ایجنت-ویس-فارسی'
$keyFile = Join-Path $dataDir 'deepgram.key'

# origin هایی که اجازهٔ نوشتن کلید دارند. چرا نشانی آنلاین هم در فهرست است:
# کاربر اپ را از GitHub Pages باز می‌کند ولی ابزار تایپ صوتی روی همین رایانه
# است؛ بدون این، دکمهٔ «راه‌اندازی تایپ صوتی» فقط در نسخهٔ محلی کار می‌کرد.
# این همچنان فهرستی بسته است و نه '*' — صفحهٔ دلخواهی نمی‌تواند کلید بنویسد،
# و Origin برابر null (یعنی file://) هم بیرون فهرست می‌ماند.
$webOrigin = 'https://sefidgaransaeed-ai.github.io'
$allowed = @("http://localhost:$Port", "http://127.0.0.1:$Port", "http://[::1]:$Port", $webOrigin)

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.ico'  = 'image/x-icon'
  '.woff2'= 'font/woff2'
  '.txt'  = 'text/plain; charset=utf-8'
  '.mp3'  = 'audio/mpeg'
  '.wav'  = 'audio/wav'
}

# فقط روی لوپ‌بک گوش می‌دهیم؛ از بیرون شبکه در دسترس نیست
# روی هر دو پشته گوش می‌دهیم.
# چرا هر دو: روی ویندوز، localhost اول به ::1 حل می‌شود و مرورگر هم اول همان را
# می‌زند. اگر فقط 127.0.0.1 را بگیریم، صفحه با خطای اتصال بالا نمی‌آید — هرچند
# ابزارهای خط فرمان که به IPv4 برمی‌گردند درست کار می‌کنند و آدم را گمراه می‌کنند.
# هر دو عمداً فقط لوپ‌بک‌اند تا سرور از بیرون شبکه در دسترس نباشد.
$listeners = @()
foreach ($ip in @([System.Net.IPAddress]::Loopback, [System.Net.IPAddress]::IPv6Loopback)) {
  try {
    $l = New-Object System.Net.Sockets.TcpListener($ip, $Port)
    $l.Start()
    $listeners += $l
  } catch {
    Write-Host "  هشدار: گوش دادن روی $($ip.ToString()) ممکن نشد." -ForegroundColor Yellow
  }
}
if ($listeners.Count -eq 0) {
  # درگاه گرفته است — ولی شاید خودِ همین اپ از اجرای قبلی هنوز بالاست.
  # آن وقت مردن با پیام خطا فقط گیج می‌کند: دابل‌کلیک دوم باید مرورگر را باز
  # کند، چون از دید کاربر اپ دارد کار می‌کند.
  $alive = $false
  try {
    $probe = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 5
    $alive = ($probe.StatusCode -eq 200 -and $probe.Content -match 'ایجنت ویس فارسی')
  } catch { }

  if ($alive) {
    Write-Host ""
    Write-Host "  اپ از قبل روی درگاه $Port در حال اجراست." -ForegroundColor Cyan
    Write-Host "  نشانی: http://localhost:$Port/" -ForegroundColor Green
    Write-Host "  (پنجرهٔ سرورِ قبلی را نبندید.)" -ForegroundColor DarkGray
    Write-Host ""
    if (-not $NoBrowser) { Start-Process "http://localhost:$Port/" }
    exit 0
  }

  Write-Host "درگاه $Port آزاد نیست و چیز دیگری آن را گرفته است." -ForegroundColor Red
  Write-Host "با -Port یک عدد دیگر بدهید. مثال: serve.ps1 -Port 9000" -ForegroundColor Yellow
  exit 1
}

$url = "http://localhost:$Port/"
Write-Host ""
Write-Host "  ایجنت ویس فارسی" -ForegroundColor Cyan
Write-Host "  در حال سرو از: $root"
Write-Host "  نشانی:         $url" -ForegroundColor Green
Write-Host "  جایگزین:       http://127.0.0.1:$Port/"
Write-Host "  گوش دادن روی:  $($listeners.Count) نشانی (IPv4 و IPv6)"
Write-Host "  توقف:          Ctrl+C"
Write-Host ""

if (-not $NoBrowser) {
  try { Start-Process $url } catch { }
}

function Send-Response {
  param($stream, [int]$code, [string]$status, [string]$type, [byte[]]$body, [string[]]$extra = @())
  $head = "HTTP/1.1 $code $status`r`n" +
          "Content-Type: $type`r`n" +
          "Content-Length: $($body.Length)`r`n" +
          "Cache-Control: no-store`r`n"
  foreach ($e in $extra) { if ($e) { $head += "$e`r`n" } }
  $head += "Connection: close`r`n`r`n"
  $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($hb, 0, $hb.Length)
  if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}

# سرآیندهای CORS برای /api/key. تنها origin هایی که در $allowed هستند به اینجا
# می‌رسند، پس بازتابِ کور نیست. Allow-Private-Network برای کروم است: درخواست از
# یک صفحهٔ عمومی به نشانی لوپ‌بک «دسترسی به شبکهٔ خصوصی» شمرده می‌شود و کروم
# پیش‌پرواز می‌فرستد؛ بی این سرآیند، درخواست پیش از رسیدن به کد رد می‌شود.
function Get-CorsHeaders {
  param([string]$origin)
  @(
    "Access-Control-Allow-Origin: $origin",
    'Access-Control-Allow-Methods: POST, OPTIONS',
    'Access-Control-Allow-Headers: Content-Type',
    'Access-Control-Allow-Private-Network: true',
    'Access-Control-Max-Age: 600',
    'Vary: Origin'
  )
}

# مرورگرها اتصال‌ها را از پیش باز می‌کنند و اغلب هیچ درخواستی روی آن‌ها نمی‌فرستند.
# این حلقه تک‌رشته‌ای است، پس هر انتظاری روی یک اتصالِ ساکت، بقیه را هم می‌خواباند.
# راه‌حل: هیچ‌وقت روی یک اتصال منتظر نمی‌مانیم. اتصال‌های پذیرفته‌شده در یک صف
# می‌نشینند و هر دور فقط آن‌هایی رسیدگی می‌شوند که دادهٔ آماده دارند؛ بقیه بعد از
# مهلتشان دور انداخته می‌شوند.
$queue = New-Object System.Collections.ArrayList

try {
  while ($true) {
    $did = $false

    # ۱) اتصال‌های تازه را بدون انتظار بردار
    foreach ($l in $listeners) {
      while ($l.Pending()) {
        $c = $l.AcceptTcpClient()
        $c.ReceiveTimeout = 5000
        $c.SendTimeout = 5000
        [void]$queue.Add([pscustomobject]@{
          Client = $c
          Expires = (Get-Date).AddSeconds(10)
        })
        $did = $true
      }
    }

    # ۲) فقط آن‌هایی را که حرفی برای گفتن دارند رسیدگی کن
    for ($i = $queue.Count - 1; $i -ge 0; $i--) {
      $item = $queue[$i]
      $client = $item.Client
      $ready = $false
      try { $ready = $client.Connected -and $client.GetStream().DataAvailable } catch { }

      if (-not $ready) {
        if ((Get-Date) -ge $item.Expires -or -not $client.Connected) {
          try { $client.Close() } catch { }
          $queue.RemoveAt($i)
        }
        continue
      }

      $queue.RemoveAt($i)
      $did = $true

    try {
      $stream = $client.GetStream()
      $stream.ReadTimeout = 5000
      $stream.WriteTimeout = 5000

      # فقط خط اول درخواست را لازم داریم
      $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII)
      $line = $reader.ReadLine()
      if (-not $line) { continue }

      $parts = $line -split ' '
      if ($parts.Count -lt 2) { continue }
      $method = $parts[0]
      $path = $parts[1]

      # ——— OPTIONS /api/key ——— پیش‌پروازِ CORS
      # باید مثل POST پیش از رد کردن غیر-GET بیاید وگرنه ۴۰۵ می‌خورد.
      if ($method -eq 'OPTIONS' -and $path -eq '/api/key') {
        $origin = ''
        while ($true) {
          $h = $reader.ReadLine()
          if ($null -eq $h -or $h -eq '') { break }
          if ($h -match '^(?i)origin:\s*(.+)$') { $origin = $Matches[1].Trim() }
        }
        if ($allowed -contains $origin) {
          Send-Response $stream 200 'OK' 'text/plain; charset=utf-8' (New-Object byte[] 0) (Get-CorsHeaders $origin)
        } else {
          Send-Response $stream 403 'Forbidden' 'text/plain; charset=utf-8' (New-Object byte[] 0)
          Write-Host "  403  OPTIONS /api/key  (origin: $origin)" -ForegroundColor Red
        }
        continue
      }

      # ——— POST /api/key ———
      # چرا سرور اجازهٔ نوشتن گرفت: کلید Deepgram فقط در localStorage مرورگر است
      # و ابزار ویندوزی از بیرون نمی‌تواند بخواندش. این تنها پلِ ممکن است.
      # سه قید: فقط همین مسیر، فقط از origin خودِ همین صفحه (صفحهٔ دیگری در
      # مرورگر نباید بتواند کلید بنویسد)، و سقف حجم بدنه.
      if ($method -eq 'POST' -and $path -eq '/api/key') {
        $len = 0; $origin = ''
        while ($true) {
          $h = $reader.ReadLine()
          if ($null -eq $h -or $h -eq '') { break }
          if ($h -match '^(?i)content-length:\s*(\d+)') { $len = [int]$Matches[1] }
          if ($h -match '^(?i)origin:\s*(.+)$')         { $origin = $Matches[1].Trim() }
        }

        if ($allowed -notcontains $origin) {
          Send-Response $stream 403 'Forbidden' 'application/json; charset=utf-8' `
            ([System.Text.Encoding]::UTF8.GetBytes('{"ok":false,"message":"origin مجاز نیست"}'))
          Write-Host "  403  /api/key  (origin: $origin)" -ForegroundColor Red
          continue
        }
        # از اینجا به بعد origin مجاز است. بی این سرآیندها مرورگر پاسخ را به
        # صفحهٔ آنلاین نمی‌دهد و کاربر فقط «نرسید» می‌دید.
        $cors = Get-CorsHeaders $origin

        if ($len -le 0 -or $len -gt 4096) {
          Send-Response $stream 400 'Bad Request' 'application/json; charset=utf-8' `
            ([System.Text.Encoding]::UTF8.GetBytes('{"ok":false,"message":"بدنه نامعتبر"}')) $cors
          continue
        }

        $buf = New-Object char[] $len
        $got = $reader.Read($buf, 0, $len)
        $plain = (-join $buf[0..($got - 1)]).Trim().Trim('"').Trim()

        if ($plain.Length -lt 20 -or $plain -match '\s') {
          Send-Response $stream 400 'Bad Request' 'application/json; charset=utf-8' `
            ([System.Text.Encoding]::UTF8.GetBytes('{"ok":false,"message":"شکل کلید درست نیست"}')) $cors
          Write-Host "  400  /api/key  شکل کلید" -ForegroundColor Yellow
          continue
        }

        # پیش از ذخیره آزموده می‌شود تا آشغال ذخیره نشود. مصرف اعتبار صوتی ندارد.
        $okKey = $false; $note = ''
        try {
          [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
          $pr = Invoke-RestMethod -Uri 'https://api.deepgram.com/v1/projects' `
                  -Headers @{ Authorization = "Token $plain" } -TimeoutSec 30
          $okKey = $true
          $note = "$(@($pr.projects).Count) پروژه"
        } catch {
          $st = 0
          if ($_.Exception.Response) { $st = [int]$_.Exception.Response.StatusCode }
          $note = switch ($st) {
            401 { 'کلید را Deepgram نپذیرفت' }
            402 { 'اعتبار حساب تمام شده' }
            403 { 'کشورِ آی‌پی پشتیبانی نمی‌شود — VPN آلمان' }
            0   { 'اتصال به Deepgram برقرار نشد' }
            default { "خطای Deepgram ($st)" }
          }
        }

        if (-not $okKey) {
          $j = '{"ok":false,"message":"' + $note + '"}'
          Send-Response $stream 200 'OK' 'application/json; charset=utf-8' `
            ([System.Text.Encoding]::UTF8.GetBytes($j)) $cors
          Write-Host "  /api/key  رد شد: $note" -ForegroundColor Yellow
          continue
        }

        if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Force $dataDir | Out-Null }
        $sec = ConvertTo-SecureString $plain -AsPlainText -Force
        ConvertFrom-SecureString $sec | Set-Content -Path $keyFile -Encoding UTF8

        # و همان‌جا ابزار میان‌بر را بالا می‌آوریم تا کاربر کار دیگری نداشته باشد
        $started = $false
        try {
          $vt = Join-Path $root 'voicetype.ps1'
          if (Test-Path $vt) {
            Start-Process powershell -ArgumentList @(
              '-ExecutionPolicy','Bypass','-NoProfile','-File',$vt
            ) -WindowStyle Minimized | Out-Null
            $started = $true
          }
        } catch { }

        $msg = "کلید ذخیره شد ($note)." + $(if ($started) { ' تایپ صوتی سراسری راه افتاد.' } else { ' ولی ابزار بالا نیامد.' })
        $j = '{"ok":true,"started":' + $started.ToString().ToLower() + ',"message":"' + $msg + '"}'
        Send-Response $stream 200 'OK' 'application/json; charset=utf-8' `
          ([System.Text.Encoding]::UTF8.GetBytes($j)) $cors
        Write-Host "  200  /api/key  ذخیره شد، راه‌اندازی=$started" -ForegroundColor Green
        continue
      }

      if ($method -ne 'GET' -and $method -ne 'HEAD') {
        Send-Response $stream 405 'Method Not Allowed' 'text/plain; charset=utf-8' `
          ([System.Text.Encoding]::UTF8.GetBytes('فقط GET'))
        continue
      }

      # حذف رشتهٔ پرسش و رمزگشایی درصدی (نام فایل‌ها فارسی‌اند)
      $path = ($path -split '\?')[0]
      $path = [System.Uri]::UnescapeDataString($path)
      if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }

      $rel = $path.TrimStart('/').Replace('/', '\')
      $full = [System.IO.Path]::GetFullPath((Join-Path $root $rel))

      # جلوگیری از بیرون رفتن از پوشهٔ پروژه
      if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        Send-Response $stream 403 'Forbidden' 'text/plain; charset=utf-8' `
          ([System.Text.Encoding]::UTF8.GetBytes('دسترسی مجاز نیست'))
        Write-Host "  403  $path" -ForegroundColor Red
        continue
      }

      if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
        Send-Response $stream 404 'Not Found' 'text/plain; charset=utf-8' `
          ([System.Text.Encoding]::UTF8.GetBytes('پیدا نشد: ' + $path))
        Write-Host "  404  $path" -ForegroundColor Yellow
        continue
      }

      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $type = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($full)

      if ($method -eq 'HEAD') { $bytes = New-Object byte[] 0 }
      Send-Response $stream 200 'OK' $type $bytes
      Write-Host "  200  $path  ($($bytes.Length) بایت)" -ForegroundColor DarkGray

    } catch {
      Write-Host "  خطا: $($_.Exception.Message)" -ForegroundColor Red
    } finally {
      try { $client.Close() } catch { }
    }
    } # پایان حلقهٔ صف

    # فقط وقتی هیچ کاری نبود می‌خوابیم؛ وگرنه بی‌درنگ دور بعد
    if (-not $did) { Start-Sleep -Milliseconds 10 }
  }
} finally {
  foreach ($item in $queue) { try { $item.Client.Close() } catch { } }
  foreach ($l in $listeners) { try { $l.Stop() } catch { } }
  Write-Host "`nسرور متوقف شد." -ForegroundColor Cyan
}
