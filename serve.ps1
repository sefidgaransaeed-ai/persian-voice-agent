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
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
try {
  $listener.Start()
} catch {
  Write-Host "درگاه $Port آزاد نیست. با -Port یک عدد دیگر بدهید." -ForegroundColor Red
  exit 1
}

$url = "http://localhost:$Port/"
Write-Host ""
Write-Host "  ایجنت ویس فارسی" -ForegroundColor Cyan
Write-Host "  در حال سرو از: $root"
Write-Host "  نشانی:         $url" -ForegroundColor Green
Write-Host "  توقف:          Ctrl+C"
Write-Host ""

if (-not $NoBrowser) {
  try { Start-Process $url } catch { }
}

function Send-Response {
  param($stream, [int]$code, [string]$status, [string]$type, [byte[]]$body)
  $head = "HTTP/1.1 $code $status`r`n" +
          "Content-Type: $type`r`n" +
          "Content-Length: $($body.Length)`r`n" +
          "Cache-Control: no-store`r`n" +
          "Connection: close`r`n`r`n"
  $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($hb, 0, $hb.Length)
  if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $client.ReceiveTimeout = 5000
      $stream = $client.GetStream()

      # فقط خط اول درخواست را لازم داریم
      $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII)
      $line = $reader.ReadLine()
      if (-not $line) { continue }

      $parts = $line -split ' '
      if ($parts.Count -lt 2) { continue }
      $method = $parts[0]
      $path = $parts[1]

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
  }
} finally {
  $listener.Stop()
  Write-Host "`nسرور متوقف شد." -ForegroundColor Cyan
}
