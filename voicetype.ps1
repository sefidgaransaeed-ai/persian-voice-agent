# تایپ صوتی سراسری — میان‌بر ویندوزی، بیرون از مرورگر.
#
# چرا اسکریپت جداست و در اپ وب نیست: صفحهٔ وب نه می‌تواند میان‌بر سراسری ویندوز
# ثبت کند و نه در پنجرهٔ برنامهٔ دیگری تایپ کند — سندباکس مرورگر اجازه نمی‌دهد.
# پس این کار ناچار بیرون از مرورگر انجام می‌شود.
#
# چرا winmm.dll و نه کتابخانهٔ صوتی: قید «بدون وابستگی» مخزن. winmm در خود
# ویندوز هست و waveIn قالب را دقیق می‌گیرد — PCM تک‌کاناله ۱۶ بیتی ۱۶ کیلوهرتز،
# همان قالبی که js/audio.js می‌سازد و Deepgram می‌خواهد.
# (MCI ساده‌تر بود ولی «set bitspersample 16» را رد می‌کند و بی‌صدا به ۸ بیت
# برمی‌گردد؛ آزمایش شد.)
#
# مدل و زبان از js/config.js خوانده می‌شوند تا این دو جا از هم جدا نیفتند.
#
# اجرا:  دابل‌کلیک روی «تایپ-صوتی.cmd»
#        یا: powershell -ExecutionPolicy Bypass -NoProfile -File voicetype.ps1

param(
  [string]$Model,
  [string]$Language,
  [switch]$ResetKey,      # کلید Deepgram را دوباره بپرس
  [switch]$NoPaste,       # فقط در کلیپ‌بورد بگذار، Ctrl+V نزن
  [switch]$Show,          # پنجرهٔ کنسول را کوچک نکن (برای عیب‌یابی)
  [switch]$SelfTest,      # مسیر صدا و پیکربندی را بیازما و خارج شو
  [switch]$SaveKey,       # کلید را بیازما و ذخیره کن، بعد خارج شو
  [int]$Diagnose = 0,     # این تعداد ثانیه ضبط کن و همه‌چیز را گزارش بده
  [string]$Key,           # کلید Deepgram؛ ندادنش یعنی از کلیپ‌بورد بخوان
  [switch]$Settings,      # پنجرهٔ انتخاب میان‌بر را باز کن، بعد خارج شو
  # ندادنش یعنی: از فایل تنظیمات، و اگر نبود پیش‌فرض.
  # Ctrl+Alt+Space روی این دستگاه گرفته بود (خطای 1409)، پس پیش‌فرض این نشد.
  [string]$Hotkey,
  # پس از این مدت سکوت، ضبط خودش تمام می‌شود. یعنی یک بار زدن میان‌بر کافی است.
  # ۱٫۶ ثانیه کم بود: مکث طبیعی میان جمله‌های فارسی از آن بلندتر است و ضبط
  # وسط حرف بریده می‌شد (ضبط‌های ۲٫۸ و ۳٫۳ ثانیه‌ای در گزارش).
  [double]$AutoStopSeconds = 2.5,
  [double]$NoSpeechSeconds = 8,   # اگر هیچ حرفی نیامد، بیهوده ضبط نکن
  [int]$MaxSeconds = 120  # سقف ایمنی؛ با توقف خودکار به‌ندرت به آن می‌رسیم
)

$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'تایپ صوتی فارسی'   # لانچر نمی‌تواند؛ کدپیج OEM خردش می‌کند
# PowerShell 5.1 پیش‌فرض TLS 1.0 می‌گیرد و Deepgram دست رد می‌زند
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root      = Split-Path -Parent $MyInvocation.MyCommand.Path
$dataDir   = Join-Path $env:LOCALAPPDATA 'ایجنت-ویس-فارسی'
$keyFile   = Join-Path $dataDir 'deepgram.key'
$glossFile = Join-Path $dataDir 'واژه‌نامه.txt'
$cfgFile   = Join-Path $dataDir 'تنظیمات.json'
$wavFile   = Join-Path $env:TEMP 'fa-voice-hotkey.wav'

Add-Type -AssemblyName System.Windows.Forms

Add-Type @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct NativeMsg {
  public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam;
  public uint time; public int x; public int y;
}

public class Native {
  [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint mods, uint vk);
  [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
  [DllImport("user32.dll")] public static extern bool PeekMessage(out NativeMsg msg, IntPtr hWnd, uint min, uint max, uint remove);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, IntPtr p, int cb);

  // ——— تایپ مستقیم یونیکد ———
  // SendKeys('^v') قابل اتکا نبود: در آزمون، Notepad فقط حرف «v» می‌گرفت —
  // یعنی Ctrl نمی‌رسید. SendInput با KEYEVENTF_UNICODE هر نویسه را مستقل
  // می‌فرستد: نه کلیپ‌بورد لازم است، نه کلید تغییردهنده، نه مسابقهٔ زمانی.
  // فارسی، راست‌به‌چپ، نیم‌فاصله و نقطه‌گذاری همان‌طور که هستند می‌روند.
  //
  // اندازهٔ INPUT به معماری بستگی دارد (۴۰ بایت روی x64، ۲۸ روی x86)، پس
  // به‌جای حدس زدن چیدمان struct، بایت‌ها را با آفست محاسبه‌شده می‌نویسیم.
  public static uint TypeUnicode(string s) {
    if (string.IsNullOrEmpty(s)) return 0;
    int ptr = IntPtr.Size;
    int size = (ptr == 8) ? 40 : 28;   // sizeof(INPUT)
    int off  = (ptr == 8) ? 8  : 4;    // آفست اجتماع KEYBDINPUT
    int n = s.Length * 2;              // برای هر نویسه: فشردن و رها کردن
    IntPtr buf = Marshal.AllocHGlobal(size * n);
    try {
      for (int i = 0; i < size * n; i++) Marshal.WriteByte(buf, i, 0);
      int idx = 0;
      foreach (char c in s) {
        for (int k = 0; k < 2; k++) {
          long b = buf.ToInt64() + (long)idx * size;
          Marshal.WriteInt32(new IntPtr(b), 0, 1);                    // INPUT_KEYBOARD
          Marshal.WriteInt16(new IntPtr(b + off + 0), 0);             // wVk = 0
          Marshal.WriteInt16(new IntPtr(b + off + 2), (short)c);      // wScan = نویسه
          // KEYEVENTF_UNICODE = 4، با KEYEVENTF_KEYUP = 2 برای رها کردن
          Marshal.WriteInt32(new IntPtr(b + off + 4), k == 0 ? 4 : 6);
          idx++;
        }
      }
      return SendInput((uint)n, buf, size);
    } finally { Marshal.FreeHGlobal(buf); }
  }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder buf, int len);
}

// ——— ضبط با waveIn، نه MCI ———
// MCI روی این ویندوز «set bitspersample 16» را رد می‌کند و بی‌صدا به ۸ بیت
// برمی‌گردد. صدای ۸ بیتی پرنویز است و دقت رونویسی را پایین می‌آورد — یعنی
// دقیقاً همان چیزی که قرار بود بهتر شود. waveIn باز هم همان winmm.dll است
// (بدون وابستگی) ولی قالب را دقیق می‌گیرد: PCM تک‌کاناله ۱۶ بیتی،
// همان قالبی که js/audio.js می‌سازد و Deepgram می‌خواهد.
public class WaveRec {
  [StructLayout(LayoutKind.Sequential, Pack = 1)]
  struct WAVEFORMATEX {
    public ushort wFormatTag; public ushort nChannels; public uint nSamplesPerSec;
    public uint nAvgBytesPerSec; public ushort nBlockAlign; public ushort wBitsPerSample; public ushort cbSize;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct WAVEHDR {
    public IntPtr lpData; public uint dwBufferLength; public uint dwBytesRecorded;
    public IntPtr dwUser; public uint dwFlags; public uint dwLoops;
    public IntPtr lpNext; public IntPtr reserved;
  }

  [DllImport("winmm.dll")] static extern int waveInGetNumDevs();
  [DllImport("winmm.dll")] static extern int waveInOpen(out IntPtr h, uint dev, ref WAVEFORMATEX fmt, IntPtr cb, IntPtr inst, uint flags);
  [DllImport("winmm.dll")] static extern int waveInClose(IntPtr h);
  [DllImport("winmm.dll")] static extern int waveInPrepareHeader(IntPtr h, IntPtr hdr, int size);
  [DllImport("winmm.dll")] static extern int waveInUnprepareHeader(IntPtr h, IntPtr hdr, int size);
  [DllImport("winmm.dll")] static extern int waveInAddBuffer(IntPtr h, IntPtr hdr, int size);
  [DllImport("winmm.dll")] static extern int waveInStart(IntPtr h);
  [DllImport("winmm.dll")] static extern int waveInStop(IntPtr h);
  [DllImport("winmm.dll")] static extern int waveInReset(IntPtr h);
  [DllImport("winmm.dll", CharSet = CharSet.Unicode)] static extern int waveInGetErrorText(int err, StringBuilder buf, int len);

  IntPtr h = IntPtr.Zero, data = IntPtr.Zero, hdr = IntPtr.Zero;
  int rate, hdrSize;

  public double LastPeak = 0;   // اوج دامنه، ۰ تا ۱
  public double LastRms  = 0;   // دامنهٔ مؤثر، ۰ تا ۱ — معیار اصلی بلندی
  public double LastGain = 1;   // ضریب تقویتی که اعمال شد
  public int    TrimMs   = 150; // این مدت از ابتدای ضبط دور ریخته می‌شود

  public static int DeviceCount { get { return waveInGetNumDevs(); } }

  static void Check(int rc) {
    if (rc == 0) return;
    StringBuilder b = new StringBuilder(256);
    waveInGetErrorText(rc, b, b.Capacity);
    throw new Exception("میکروفون: " + b.ToString());
  }

  public void Start(int sampleRate, int maxSeconds) {
    if (waveInGetNumDevs() == 0) throw new Exception("میکروفونی پیدا نشد.");
    rate = sampleRate;
    WAVEFORMATEX f = new WAVEFORMATEX();
    f.wFormatTag = 1; f.nChannels = 1; f.nSamplesPerSec = (uint)rate;
    f.wBitsPerSample = 16; f.nBlockAlign = 2; f.nAvgBytesPerSec = (uint)(rate * 2); f.cbSize = 0;
    Check(waveInOpen(out h, 0xFFFFFFFF, ref f, IntPtr.Zero, IntPtr.Zero, 0));

    // یک بافر بزرگ به اندازهٔ کل سقف زمانی: بدون callback و بدون نوبت‌گردانی.
    // همین سقف، ضبطِ فراموش‌شده را هم خودبه‌خود محدود می‌کند.
    int bytes = rate * 2 * maxSeconds;
    data = Marshal.AllocHGlobal(bytes);
    WAVEHDR w = new WAVEHDR();
    w.lpData = data; w.dwBufferLength = (uint)bytes;
    hdrSize = Marshal.SizeOf(typeof(WAVEHDR));
    // WAVEHDR باید تا پایان ضبط سرِ جایش بماند چون درایور بعداً در آن می‌نویسد،
    // پس در حافظهٔ مدیریت‌نشده می‌نشیند نه روی هیپ دات‌نت که جابه‌جا می‌شود.
    hdr = Marshal.AllocHGlobal(hdrSize);
    Marshal.StructureToPtr(w, hdr, false);
    Check(waveInPrepareHeader(h, hdr, hdrSize));
    Check(waveInAddBuffer(h, hdr, hdrSize));
    Check(waveInStart(h));
  }

  // اوج دامنه در آخرین پنجرهٔ زمانی — برای تشخیص سکوت هنگام ضبط.
  // از همان بافری خوانده می‌شود که درایور دارد پرش می‌کند.
  public double LiveLevel(int windowMs) {
    if (hdr == IntPtr.Zero || data == IntPtr.Zero) return 0;
    WAVEHDR w = (WAVEHDR)Marshal.PtrToStructure(hdr, typeof(WAVEHDR));
    int n = (int)w.dwBytesRecorded;
    if (n < 2) return 0;
    int want = rate * 2 * windowMs / 1000;
    int from = n - want; if (from < 0) from = 0;
    int count = n - from; if (count < 2) return 0;
    byte[] buf = new byte[count];
    Marshal.Copy(new IntPtr(data.ToInt64() + from), buf, 0, count);
    int maxAbs = 0;
    for (int i = 0; i + 1 < count; i += 2) {
      int s = (short)(buf[i] | (buf[i + 1] << 8));
      int a = s < 0 ? -s : s;
      if (a > maxAbs) maxAbs = a;
    }
    return maxAbs / 32767.0;
  }

  // برمی‌گرداند: شمار بایت‌های PCM ضبط‌شده
  public int SaveWav(string path) {
    waveInStop(h);
    waveInReset(h);   // بافر را برمی‌گرداند و dwBytesRecorded را پر می‌کند
    WAVEHDR w = (WAVEHDR)Marshal.PtrToStructure(hdr, typeof(WAVEHDR));
    int n = (int)w.dwBytesRecorded;
    byte[] all = new byte[n];
    if (n > 0) Marshal.Copy(data, all, 0, n);
    Free();

    // ——— حذف ضربهٔ آغازین ———
    // باز شدن دستگاه یک ضربهٔ گذرا (کلیک DC) می‌سازد که دامنه‌اش تا بیشینه
    // می‌رود. همان یک نمونه اوج را ۱۰۰٪ نشان می‌داد، ضریب تقویت ۱ می‌شد و
    // گفتارِ آرام آرام می‌ماند — Deepgram نیمی از بارها چیزی برنمی‌گرداند.
    int skip = rate * 2 * TrimMs / 1000;
    skip -= skip % 2;                      // روی مرز نمونه بماند
    if (skip >= n) skip = 0;
    int len = n - skip;
    byte[] pcm = new byte[len];
    if (len > 0) Array.Copy(all, skip, pcm, 0, len);

    // ——— هنجارسازی بر پایهٔ RMS، نه اوج ———
    // اوج به یک تک‌ضربه حساس است؛ RMS بلندیِ واقعیِ گفتار را می‌سنجد.
    // محدودکننده از صدک ۹۹٫۹ حساب می‌شود تا ضربهٔ باقی‌مانده ضریب را نکُشد.
    LastPeak = 0; LastRms = 0; LastGain = 1;
    if (len >= 2) {
      int[] hist = new int[1025];
      double sumSq = 0; int count = 0, maxAbs = 0;
      for (int i = 0; i + 1 < len; i += 2) {
        int s = (short)(pcm[i] | (pcm[i + 1] << 8));
        int a = s < 0 ? -s : s;
        sumSq += (double)s * s; count++;
        if (a > maxAbs) maxAbs = a;
        hist[a >> 5]++;
      }
      double rms = count > 0 ? Math.Sqrt(sumSq / count) : 0;
      LastPeak = maxAbs / 32767.0;
      LastRms  = rms / 32767.0;

      int need = (int)(count * 0.999);
      int acc = 0, p999 = maxAbs;
      for (int k = 0; k < hist.Length; k++) {
        acc += hist[k];
        if (acc >= need) { p999 = (k << 5) + 31; break; }
      }

      // هدف ~۱۲٪ RMS (حدود ۱۸- dBFS) که برای گفتار متعارف است
      double gain = 1;
      if (rms > 20) {                       // کفِ نویز را تقویت نمی‌کنیم
        gain = (0.12 * 32767.0) / rms;
        if (gain > 12) gain = 12;
        if (p999 > 0) {
          double lim = (0.95 * 32767.0) / p999;
          if (lim < gain) gain = lim;
        }
        if (gain < 1) gain = 1;             // تضعیف نمی‌کنیم
      }
      LastGain = gain;

      if (gain > 1.001) {
        for (int i = 0; i + 1 < len; i += 2) {
          int s = (short)(pcm[i] | (pcm[i + 1] << 8));
          int v = (int)(s * gain);
          if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
          pcm[i] = (byte)(v & 0xFF);
          pcm[i + 1] = (byte)((v >> 8) & 0xFF);
        }
      }
    }
    int nOut = len;

    // همان سرآیند ۴۴ بایتی که js/audio.js می‌نویسد
    using (FileStream fs = new FileStream(path, FileMode.Create))
    using (BinaryWriter bw = new BinaryWriter(fs)) {
      bw.Write(Encoding.ASCII.GetBytes("RIFF")); bw.Write(36 + nOut);
      bw.Write(Encoding.ASCII.GetBytes("WAVE"));
      bw.Write(Encoding.ASCII.GetBytes("fmt ")); bw.Write(16);
      bw.Write((short)1); bw.Write((short)1); bw.Write(rate);
      bw.Write(rate * 2); bw.Write((short)2); bw.Write((short)16);
      bw.Write(Encoding.ASCII.GetBytes("data")); bw.Write(nOut);
      bw.Write(pcm, 0, nOut);
    }
    return nOut;
  }

  // ترتیب اینجا مهم است: تا بافر «unprepare» نشده، درایور هنوز به همان حافظه
  // اشاره دارد. آزاد کردنِ زودهنگامش هیپ را خراب می‌کند و فرایند موقع خروج
  // می‌ترکد — با خودآزمایی دیده شد (کد خروج ۱۱۶).
  public void Free() {
    if (h != IntPtr.Zero) {
      waveInReset(h);                                          // بافرهای معلق را پس می‌گیرد
      if (hdr != IntPtr.Zero) waveInUnprepareHeader(h, hdr, hdrSize);
      waveInClose(h);
      h = IntPtr.Zero;
    }
    if (hdr != IntPtr.Zero) { Marshal.FreeHGlobal(hdr); hdr = IntPtr.Zero; }
    if (data != IntPtr.Zero) { Marshal.FreeHGlobal(data); data = IntPtr.Zero; }
  }
}
'@

# ——— پیکربندی: از js/config.js، تا مدل در دو جا از هم جدا نیفتد ———
function Get-AppConfig {
  $out = @{ Model = 'nova-3'; Language = 'fa'; Rate = 16000; QuietPeak = 0.02 }
  $path = Join-Path $root 'js\config.js'
  if (-not (Test-Path $path)) { return $out }
  $text = Get-Content $path -Raw -Encoding UTF8
  $m = [regex]::Match($text, "DG_MODEL\s*:\s*'([^']+)'");    if ($m.Success) { $out.Model    = $m.Groups[1].Value }
  $m = [regex]::Match($text, "LANGUAGE\s*:\s*'([^']+)'");    if ($m.Success) { $out.Language = $m.Groups[1].Value }
  $m = [regex]::Match($text, "SAMPLE_RATE\s*:\s*(\d+)");     if ($m.Success) { $out.Rate     = [int]$m.Groups[1].Value }
  $m = [regex]::Match($text, "QUIET_PEAK\s*:\s*([0-9.]+)");   if ($m.Success) { $out.QuietPeak = [double]$m.Groups[1].Value }
  return $out
}

# ——— میان‌بر: «Ctrl+Shift+Space» → کدهای ویندوز ———
function ConvertTo-Hotkey([string]$spec) {
  $ALT = 1; $CTRL = 2; $SHIFT = 4; $WIN = 8
  $mods = 0; $vk = 0; $label = @()
  foreach ($raw in ($spec -split '\+')) {
    $part = $raw.Trim(); $low = $part.ToLower()
    if     ($low -eq 'ctrl' -or $low -eq 'control') { $mods = $mods -bor $CTRL;  $label += 'Ctrl' }
    elseif ($low -eq 'alt')                        { $mods = $mods -bor $ALT;   $label += 'Alt' }
    elseif ($low -eq 'shift')                      { $mods = $mods -bor $SHIFT; $label += 'Shift' }
    elseif ($low -eq 'win')                        { $mods = $mods -bor $WIN;   $label += 'Win' }
    elseif ($low -eq 'space')                      { $vk = 0x20; $label += 'Space' }
    elseif ($part -match '^[Ff]([1-9]|1[0-2])$')    { $vk = 0x6F + [int]$Matches[1]; $label += $part.ToUpper() }
    elseif ($part -match '^[A-Za-z0-9]$')           { $vk = [int][char]$part.ToUpper(); $label += $part.ToUpper() }
    else { throw "کلید ناشناخته در میان‌بر: $part" }
  }
  if ($vk -eq 0) { throw "میان‌بر «$spec» کلید اصلی ندارد." }
  return @{ Mods = $mods; Vk = $vk; Label = ($label -join '+') }
}

# ——— تنظیمات ماندگار ———
# میان‌بر باید بین اجراها بماند. سوئیچ -Hotkey همیشه مقدم است، بعد این فایل،
# بعد پیش‌فرض. کنار واژه‌نامه می‌نشیند، بیرون از مخزن.
function Get-StoredSettings {
  if (-not (Test-Path $cfgFile)) { return $null }
  try { return (Get-Content $cfgFile -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}

function Set-StoredHotkey([string]$spec) {
  if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Force $dataDir | Out-Null }
  @{ hotkey = $spec } | ConvertTo-Json | Set-Content -Path $cfgFile -Encoding UTF8
}

# آزاد بودن یک ترکیب را می‌سنجد بدون آنکه نگهش دارد
function Test-HotkeyFree([string]$spec) {
  try { $h = ConvertTo-Hotkey $spec } catch { return $false }
  if ([Native]::RegisterHotKey([IntPtr]::Zero, 77, ($h.Mods -bor 0x4000), $h.Vk)) {
    [Native]::UnregisterHotKey([IntPtr]::Zero, 77) | Out-Null
    return $true
  }
  return $false
}

# ——— پنجرهٔ انتخاب میان‌بر ———
# کلیدها فشار داده می‌شوند، نه تایپ: هم خطای تایپی ندارد و هم همان لحظه
# معلوم می‌شود ترکیب آزاد است یا برنامهٔ دیگری گرفته است.
function Show-HotkeyDialog {
  Add-Type -AssemblyName System.Drawing
  $picked = $Hotkey

  $form = New-Object Windows.Forms.Form
  $form.Text = 'میان‌بر تایپ صوتی'
  $form.ClientSize = New-Object Drawing.Size(440, 230)
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.KeyPreview = $true
  $form.RightToLeft = 'Yes'
  $form.RightToLeftLayout = $true
  $form.Font = New-Object Drawing.Font('Segoe UI', 10)

  $lbl = New-Object Windows.Forms.Label
  $lbl.Text = 'ترکیب کلیدهایی که می‌خواهید را همین حالا فشار دهید:'
  $lbl.SetBounds(20, 20, 400, 24)
  $form.Controls.Add($lbl)

  $box = New-Object Windows.Forms.Label
  $box.Text = $picked
  $box.TextAlign = 'MiddleCenter'
  $box.BorderStyle = 'FixedSingle'
  $box.Font = New-Object Drawing.Font('Consolas', 15, [Drawing.FontStyle]::Bold)
  $box.SetBounds(20, 54, 400, 48)
  $form.Controls.Add($box)

  $status = New-Object Windows.Forms.Label
  $status.TextAlign = 'MiddleCenter'
  $status.SetBounds(20, 110, 400, 26)
  $form.Controls.Add($status)

  $hint = New-Object Windows.Forms.Label
  $hint.Text = 'دست‌کم یکی از Ctrl / Alt / Shift لازم است، به همراه یک حرف، رقم، F1..F12 یا Space.'
  $hint.ForeColor = [Drawing.Color]::Gray
  $hint.SetBounds(20, 136, 400, 34)
  $form.Controls.Add($hint)

  $save = New-Object Windows.Forms.Button
  $save.Text = 'ذخیره'
  $save.SetBounds(20, 180, 110, 32)
  $save.DialogResult = [Windows.Forms.DialogResult]::OK
  $form.Controls.Add($save)
  $form.AcceptButton = $save

  $cancel = New-Object Windows.Forms.Button
  $cancel.Text = 'انصراف'
  $cancel.SetBounds(140, 180, 110, 32)
  $cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
  $form.Controls.Add($cancel)
  $form.CancelButton = $cancel

  function Set-Status([string]$spec) {
    if (Test-HotkeyFree $spec) {
      $status.Text = 'آزاد است'
      $status.ForeColor = [Drawing.Color]::FromArgb(0, 128, 0)
      $save.Enabled = $true
    } else {
      $status.Text = 'برنامهٔ دیگری این ترکیب را گرفته است'
      $status.ForeColor = [Drawing.Color]::FromArgb(190, 0, 0)
      $save.Enabled = $false
    }
  }
  Set-Status $picked

  $form.add_KeyDown({
    $e = $_
    $kc = $e.KeyCode
    # کلید همراه به‌تنهایی ترکیب نیست؛ منتظر کلید اصلی می‌مانیم
    if ($kc -eq 'ControlKey' -or $kc -eq 'ShiftKey' -or $kc -eq 'Menu' -or
        $kc -eq 'LWin' -or $kc -eq 'RWin') { return }
    $e.SuppressKeyPress = $true

    $n = [int]$kc
    $main = $null
    if     ($kc -eq 'Space')            { $main = 'Space' }
    elseif ($n -ge 65 -and $n -le 90)   { $main = [string][char]$n }        # A..Z
    elseif ($n -ge 48 -and $n -le 57)   { $main = [string][char]$n }        # 0..9
    elseif ($n -ge 112 -and $n -le 123) { $main = 'F' + ($n - 111) }        # F1..F12
    if (-not $main) { return }

    $parts = @()
    if ($e.Control) { $parts += 'Ctrl' }
    if ($e.Alt)     { $parts += 'Alt' }
    if ($e.Shift)   { $parts += 'Shift' }
    if ($parts.Count -eq 0) {
      $status.Text = 'دست‌کم یکی از Ctrl / Alt / Shift را هم نگه دارید'
      $status.ForeColor = [Drawing.Color]::FromArgb(190, 0, 0)
      $save.Enabled = $false
      return
    }
    $parts += $main
    $script:dlgPick = ($parts -join '+')
    $box.Text = $script:dlgPick
    Set-Status $script:dlgPick
  })

  $script:dlgPick = $picked
  $res = $form.ShowDialog()
  $form.Dispose()
  if ($res -ne [Windows.Forms.DialogResult]::OK) { return $null }
  return $script:dlgPick
}

$cfg = Get-AppConfig
if (-not $Model)    { $Model    = $cfg.Model }
if (-not $Language) { $Language = $cfg.Language }
$rate = $cfg.Rate
$quietPeak = $cfg.QuietPeak

if (-not $Hotkey) {
  $stored = Get-StoredSettings
  $Hotkey = if ($stored -and $stored.hotkey) { $stored.hotkey } else { 'Ctrl+Shift+Space' }
}

# ——— کلید: داخل فایل اسکریپت نمی‌رود ———
# با DPAPI رمزگذاری می‌شود؛ فقط همین کاربر ویندوز روی همین دستگاه بازش می‌کند.
# بیرون از مخزن می‌نشیند تا با git منتشر نشود.
function Save-KeyValue([string]$plain) {
  if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Force $dataDir | Out-Null }
  $sec = ConvertTo-SecureString $plain -AsPlainText -Force
  ConvertFrom-SecureString $sec | Set-Content -Path $keyFile -Encoding UTF8
}

# آزمودن کلید بدون مصرف اعتبار صوتی — همان کاری که App.dg.checkKey می‌کند
function Test-DeepgramKey([string]$plain) {
  try {
    $r = Invoke-RestMethod -Uri 'https://api.deepgram.com/v1/projects' `
           -Headers @{ Authorization = "Token $plain" } -TimeoutSec 30
    $n = @($r.projects).Count
    return @{ Ok = $true; Projects = $n; Name = $(if ($n) { @($r.projects)[0].name } else { '' }) }
  } catch {
    $status = 0
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    return @{ Ok = $false; Message = (Get-FriendlyError $status) }
  }
}

function Set-DeepgramKey {
  Write-Host ''
  Write-Host 'کلید Deepgram را وارد کنید (هنگام تایپ نمایش داده نمی‌شود):' -ForegroundColor Cyan
  $sec = Read-Host -AsSecureString
  if ($sec.Length -eq 0) { throw 'کلیدی وارد نشد.' }
  if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Force $dataDir | Out-Null }
  ConvertFrom-SecureString $sec | Set-Content -Path $keyFile -Encoding UTF8
  Write-Host "کلید رمزگذاری‌شده ذخیره شد: $keyFile" -ForegroundColor Green
}

function Get-DeepgramKey {
  if ($ResetKey -or -not (Test-Path $keyFile)) {
    # ساده‌ترین مسیر: کاربر در اپ وب دکمهٔ «کپی کلید» را زده است. اگر کلیپ‌بورد
    # کلید معتبری دارد، همان را بگیر و هیچ نپرس. پرسشِ تعاملی در پنجره‌ای که
    # خودش کوچک می‌شود شکننده است، و خط فرمان هم دردِ بی‌جا.
    $clip = ''
    try { $clip = ([string](Get-Clipboard -Raw)).Trim().Trim('"').Trim("'").Trim() } catch { }
    $plausible = $clip -and $clip.Length -ge 20 -and $clip.Length -le 200 -and $clip -notmatch '\s'
    if ($plausible) {
      Write-Host ''
      Write-Host '  کلیدی در کلیپ‌بورد پیدا شد. در حال آزمودن…' -ForegroundColor Gray
      $t = Test-DeepgramKey $clip
      if ($t.Ok) {
        Save-KeyValue $clip
        Write-Host "  کلید درست است و ذخیره شد — $($t.Projects) پروژه" -ForegroundColor Green
        return $clip
      }
      Write-Host "  آنچه در کلیپ‌بورد بود پذیرفته نشد: $($t.Message)" -ForegroundColor DarkYellow
    }

    Write-Host ''
    Write-Host '  کلید Deepgram لازم است. ساده‌ترین راه:' -ForegroundColor Cyan
    Write-Host '    ۱) «شروع.cmd» → زبانهٔ تنظیمات → دکمهٔ «کپی کلید»' -ForegroundColor White
    Write-Host '    ۲) همین پنجره را ببندید و دوباره روی «تایپ-صوتی.cmd» بزنید' -ForegroundColor White
    Write-Host ''
    Write-Host '  یا اگر کلید را دارید، همین‌جا بچسبانید (راست‌کلیک) و Enter:' -ForegroundColor Cyan
    Set-DeepgramKey
  }
  $sec = (Get-Content $keyFile -Raw -Encoding UTF8).Trim() | ConvertTo-SecureString
  $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }
}

# ——— واژه‌نامه → keyterm ———
# همان قید js/deepgram.js: فهرست اصطلاح، نه جملهٔ قابل ادامه دادن.
# واژه‌نامهٔ اپ وب در localStorage مرورگر است و از اینجا خواندنی نیست،
# پس این یکی فایل جداگانهٔ خودش را دارد.
function Get-Glossary {
  if (-not (Test-Path $glossFile)) { return @() }
  # ترتیب مهم است: اول خط‌های توضیحی، بعد ویرگول‌ها. برعکسش باگ داشت — خطِ
  # توضیحیِ حاوی ویرگول نصف می‌شد و نیمهٔ دومش که با # شروع نمی‌شد به‌عنوان
  # keyterm به Deepgram می‌رفت. با خودآزمایی دیده شد.
  $lines = @(Get-Content $glossFile -Encoding UTF8 |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -and -not $_.StartsWith('#') })
  if (-not $lines.Count) { return @() }
  return @(($lines -join '،') -split '[،,]+' |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_.Length -gt 1 -and $_.Length -lt 60 } |
    Select-Object -First 40)
}

# ——— ضبط از میکروفون ———
$script:rec = $null

function Start-Recording {
  $script:rec = New-Object WaveRec
  $script:rec.Start($rate, $MaxSeconds)
}

# برمی‌گرداند: شمار بایت‌های ضبط‌شده
function Stop-Recording {
  if (-not $script:rec) { return }
  if (Test-Path $wavFile) { Remove-Item $wavFile -Force }
  $null = $script:rec.SaveWav($wavFile)      # $null = وگرنه شمار بایت در گزارش می‌ریخت
  $script:lastPeak = $script:rec.LastPeak
  $script:lastRms  = $script:rec.LastRms
  $script:lastGain = $script:rec.LastGain
  $script:rec = $null
}

# ——— Deepgram ———
# پیام‌های خطا همان‌هایی‌اند که js/deepgram.js به کاربر می‌دهد.
function Get-FriendlyError([int]$status) {
  switch ($status) {
    401 { return 'کلید Deepgram پذیرفته نشد. با سوئیچ -ResetKey دوباره واردش کنید.' }
    402 { return 'Deepgram درخواست را رد کرد. اعتبار حساب تمام شده یا کشورِ آی‌پی پشتیبانی نمی‌شود — گرهٔ VPN را روی آلمان بگذارید.' }
    403 { return 'Deepgram درخواست را رد کرد. اعتبار حساب تمام شده یا کشورِ آی‌پی پشتیبانی نمی‌شود — گرهٔ VPN را روی آلمان بگذارید.' }
    413 { return 'فایل صوتی بزرگ‌تر از سقف مجاز است. کوتاه‌تر حرف بزنید.' }
    429 { return 'به سقف درخواست Deepgram رسیدید. کمی صبر کنید.' }
    0   { return 'اتصال به Deepgram برقرار نشد. اینترنت یا VPN را بررسی کنید.' }
    default { return "خطای Deepgram ($status)" }
  }
}

function Get-DeepgramUrl {
  $p = @("model=$([Uri]::EscapeDataString($Model))", 'punctuate=true', 'smart_format=true')
  if ($Language -and $Language -ne 'auto') { $p += "language=$([Uri]::EscapeDataString($Language))" }
  else { $p += 'detect_language=true' }
  $url = 'https://api.deepgram.com/v1/listen?' + ($p -join '&')
  foreach ($t in Get-Glossary) { $url += '&keyterm=' + [Uri]::EscapeDataString($t) }
  return $url
}

function Invoke-Transcribe([string]$key) {
  $url = Get-DeepgramUrl
  $attempt = 0
  while ($true) {
    try {
      $res = Invoke-WebRequest -Uri $url -Method Post -InFile $wavFile `
               -ContentType 'audio/wav' -Headers @{ Authorization = "Token $key" } `
               -UseBasicParsing -TimeoutSec 120
      # PowerShell 5.1 بدنهٔ پاسخ را با ISO-8859-1 می‌خواند وقتی سرآیند
      # Content-Type کدگذاری را نگفته باشد، و Deepgram هم نمی‌گوید. نتیجه:
      # هر حرف فارسی به دو نویسهٔ لاتین می‌شکست — «سلام» می‌شد «ø³ÙØ§Ù».
      # پس بایت خام را خودمان UTF-8 می‌خوانیم.
      $body = [System.Text.Encoding]::UTF8.GetString($res.RawContentStream.ToArray())
      $j = $body | ConvertFrom-Json
      return [string]$j.results.channels[0].alternatives[0].transcript
    } catch {
      $status = 0
      if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
      # تلاش دوباره فقط روی خطاهای گذرا، مثل js/deepgram.js
      $transient = ($status -eq 429 -or $status -ge 500 -or $status -eq 0)
      if (-not $transient -or $attempt -ge 3) { throw (Get-FriendlyError $status) }
      $attempt++
      $wait = [Math]::Min(20, 2 * [Math]::Pow(2, $attempt))
      Write-Host "  تلاش دوباره پس از $wait ثانیه…" -ForegroundColor DarkYellow
      Start-Sleep -Seconds $wait
    }
  }
}

# ——— درج متن در پنجره‌ای که کاربر داشت در آن تایپ می‌کرد ———
# برمی‌گرداند: @{ Pasted = $true/$false; Reason = '…' }
#
# روش: تایپ مستقیم یونیکد با SendInput. کلیپ‌بورد اصلاً دست‌کاری نمی‌شود،
# پس مسئلهٔ «حفظ و بازگردانی» از بین می‌رود — امن‌ترین روشی که ویندوز می‌دهد
# و همان چیزی که پرامپت می‌خواست. متن هم به‌عنوان پشتوانه در کلیپ‌بورد
# گذاشته می‌شود تا اگر درج نشد از دست نرود.
#
# هیچ Enterی فرستاده نمی‌شود: خطوط جدید به فاصله تبدیل می‌شوند، وگرنه در
# چت‌باکس‌ها پیام را زودتر از موعد ارسال می‌کردند.
function Send-Transcript([string]$text, [IntPtr]$target) {
  $flat = ($text -replace '[
]+', ' ').Trim()

  # پشتوانه: اگر درج نشد، متن گم نشود
  try { Set-Clipboard -Value $flat } catch { }

  if ($NoPaste) { return @{ Pasted = $false; Reason = 'حالت فقط-کلیپ‌بورد' } }
  if ($target -eq [IntPtr]::Zero) { return @{ Pasted = $false; Reason = 'پنجرهٔ مقصد نامعلوم بود' } }

  if ([Native]::GetForegroundWindow() -ne $target) {
    [Native]::SetForegroundWindow($target) | Out-Null
    Start-Sleep -Milliseconds 220
  }
  if ([Native]::GetForegroundWindow() -ne $target) {
    return @{ Pasted = $false; Reason = 'پنجرهٔ فعال عوض شده بود' }
  }

  $sent = [Native]::TypeUnicode($flat)
  if ($sent -eq 0) { return @{ Pasted = $false; Reason = 'ویندوز ورودی را نپذیرفت' } }
  return @{ Pasted = $true }
}

function Beep-Start { [Console]::Beep(760, 90);  [Console]::Beep(1040, 90) }
function Beep-Stop  { [Console]::Beep(1040, 80); [Console]::Beep(760, 80) }
function Beep-Done  { [Console]::Beep(1250, 130) }
function Beep-Fail  { [Console]::Beep(300, 200); [Console]::Beep(240, 260) }

# عنوان پنجرهٔ مقصد — تا در گزارش معلوم باشد متن کجا می‌رود
function Get-WindowTitle([IntPtr]$h) {
  if ($h -eq [IntPtr]::Zero) { return '(نامعلوم)' }
  $b = New-Object System.Text.StringBuilder 512
  [Native]::GetWindowText($h, $b, $b.Capacity) | Out-Null
  $t = $b.ToString().Trim()
  if ($t) { return $t } else { return '(بی‌عنوان)' }
}

function Write-Line([string]$msg, [string]$color = 'Gray') {
  Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg) -ForegroundColor $color
}

# ——— راه‌اندازی ———
Write-Host ''
Write-Host '  تایپ صوتی فارسی — میان‌بر سراسری' -ForegroundColor Cyan
Write-Host '  ---------------------------------' -ForegroundColor DarkGray

# ——— پنجرهٔ تنظیمات میان‌بر ———
if ($Settings) {
  $new = Show-HotkeyDialog
  if ($new) {
    Set-StoredHotkey $new
    Write-Host ''
    Write-Host "  میان‌بر روی $new تنظیم شد." -ForegroundColor Green
    Write-Host '  اگر ابزار در حال اجراست، ببندید و دوباره بازش کنید.' -ForegroundColor Gray
    Write-Host ''
  } else {
    Write-Host ''
    Write-Host '  تغییری داده نشد.' -ForegroundColor Gray
    Write-Host ''
  }
  exit 0
}

# ——— ذخیرهٔ کلید بدون پرسش تعاملی ———
# پرسشِ تعاملی در پنجره‌ای که خودش کوچک می‌شود شکننده است. اینجا کلید از سوئیچ
# یا از کلیپ‌بورد می‌آید، پیش از ذخیره آزموده می‌شود، و هیچ‌وقت چاپ نمی‌شود.
if ($SaveKey) {
  $candidate = if ($Key) { $Key } else { [string](Get-Clipboard -Raw) }
  $candidate = $candidate.Trim().Trim('"').Trim("'").Trim()
  Write-Host ''
  if (-not $candidate) {
    Write-Host '  نه سوئیچ -Key داده شد و نه کلیپ‌بورد چیزی داشت.' -ForegroundColor Red
    exit 1
  }
  $masked = if ($candidate.Length -gt 4) { ('*' * ($candidate.Length - 4)) + $candidate.Substring($candidate.Length - 4) } else { '****' }
  Write-Host "  کلید نامزد: $masked  ($($candidate.Length) نویسه)" -ForegroundColor Gray
  Write-Host '  در حال آزمودن نزد Deepgram (بدون مصرف اعتبار صوتی)…' -ForegroundColor Gray
  $t = Test-DeepgramKey $candidate
  if (-not $t.Ok) {
    Write-Host "  $($t.Message)" -ForegroundColor Red
    Write-Host '  چیزی ذخیره نشد.' -ForegroundColor Red
    exit 1
  }
  Save-KeyValue $candidate
  Write-Host "  کلید درست است — $($t.Projects) پروژه$(if ($t.Name) { ': ' + $t.Name })" -ForegroundColor Green
  Write-Host "  رمزگذاری‌شده با DPAPI ذخیره شد: $keyFile" -ForegroundColor Green
  Write-Host ''
  exit 0
}

# ——— عیب‌یابی ———
# وقتی Deepgram رونوشت خالی می‌دهد، سه احتمال هست و از بیرون جدا نمی‌شوند:
# صدا ضبط نشده، ضبط شده ولی خراب/کم‌دامنه است، یا سالم است و Deepgram
# پارامتری را نمی‌پسندد. این حالت هر سه را از هم جدا می‌کند.
if ($Diagnose -gt 0) {
  # رونوشت کامل در فایل، تا بتوان بعداً کل گزارش را خواند
  if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Force $dataDir | Out-Null }
  $diagLog = Join-Path $dataDir 'عیب-یابی.txt'
  try { Start-Transcript -Path $diagLog -Force | Out-Null } catch { }
  $key = Get-DeepgramKey
  $keep = Join-Path ([Environment]::GetFolderPath('Desktop')) 'آزمون-صدا.wav'

  Write-Host ''
  Write-Host "  $Diagnose ثانیه ضبط می‌شود. واضح و نزدیک میکروفون حرف بزنید." -ForegroundColor Cyan
  foreach ($i in 3..1) { Write-Host "  $i…" -ForegroundColor DarkGray; Start-Sleep -Seconds 1 }
  Write-Host '  بگویید!' -ForegroundColor Green
  Beep-Start

  Start-Recording
  Start-Sleep -Seconds $Diagnose
  Stop-Recording
  Beep-Stop

  $bytes = (Get-Item $wavFile).Length
  Copy-Item $wavFile $keep -Force

  # RMS را از خودِ فایلِ ذخیره‌شده حساب می‌کنیم (پس از تقویت)
  $b = [IO.File]::ReadAllBytes($wavFile)
  $sum = 0.0; $cnt = 0; $mx = 0
  for ($i = 44; $i + 1 -lt $b.Length; $i += 2) {
    $s = [BitConverter]::ToInt16($b, $i)
    $sum += [double]$s * $s; $cnt++
    $a = [Math]::Abs([int]$s); if ($a -gt $mx) { $mx = $a }
  }
  $rms = if ($cnt) { [Math]::Sqrt($sum / $cnt) / 32767.0 } else { 0 }

  Write-Host ''
  Write-Host '  ——— صدا ———' -ForegroundColor Cyan
  Write-Host ("  حجم:            {0:N0} بایت  ({1:N1} ثانیه)" -f $bytes, (($bytes - 44) / 32000.0))
  Write-Host ("  اوج پیش از تقویت: {0:N2}٪" -f ($script:lastPeak * 100))
  Write-Host ("  تقویت اعمال‌شده:   {0:N1}×" -f $script:lastGain)
  Write-Host ("  اوج پس از تقویت:  {0:N2}٪" -f ($mx / 32767.0 * 100))
  Write-Host ("  RMS:             {0:N2}٪" -f ($rms * 100))
  if ($rms -lt 0.01) {
    Write-Host '  → تقریباً ساکت. مشکل در ضبط است، نه Deepgram.' -ForegroundColor Red
  } elseif ($rms -lt 0.03) {
    Write-Host '  → کم‌دامنه. احتمالاً برای تشخیص کافی نیست.' -ForegroundColor DarkYellow
  } else {
    Write-Host '  → دامنه معقول است.' -ForegroundColor Green
  }

  Write-Host ''
  Write-Host '  ——— پاسخ خام Deepgram ———' -ForegroundColor Cyan
  Write-Host ("  نشانی: " + (Get-DeepgramUrl)) -ForegroundColor DarkGray
  try {
    $res = Invoke-WebRequest -Uri (Get-DeepgramUrl) -Method Post -InFile $wavFile `
             -ContentType 'audio/wav' -Headers @{ Authorization = "Token $key" } `
             -UseBasicParsing -TimeoutSec 120
    Write-Host ("  HTTP " + $res.StatusCode) -ForegroundColor Green
    Write-Host ([System.Text.Encoding]::UTF8.GetString($res.RawContentStream.ToArray()))
  } catch {
    $st = 0; if ($_.Exception.Response) { $st = [int]$_.Exception.Response.StatusCode }
    Write-Host ("  HTTP $st — " + (Get-FriendlyError $st)) -ForegroundColor Red
    try {
      $sr = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
      Write-Host $sr.ReadToEnd()
    } catch { }
  }

  Write-Host ''
  Write-Host "  فایل صوتی برای گوش کردن: $keep" -ForegroundColor Yellow
  Write-Host '  رویش دابل‌کلیک کنید. اگر صدایتان واضح است، مشکل در Deepgram است؛' -ForegroundColor Gray
  Write-Host '  اگر خفه، تند، بریده یا ساکت است، مشکل در ضبط است.' -ForegroundColor Gray
  Write-Host ''
  Write-Host "  گزارش کامل در: $diagLog" -ForegroundColor DarkGray
  Write-Host ''
  try { Stop-Transcript | Out-Null } catch { }
  exit 0
}

# ——— بررسی عملکرد ———
# چهار بررسی مستقل، هر کدام با علت و راهکار. هیچ صدایی ذخیره یا فرستاده
# نمی‌شود: دستگاه صوتی فقط باز و بسته می‌شود تا پذیرش قالب معلوم شود، و
# آزمونِ سرویس روی مسیر /projects است که صدا نمی‌گیرد و اعتبار صوتی هم
# مصرف نمی‌کند. آزمونِ واقعیِ گفتار فقط در حالت -Diagnose است که پیش از
# ضبط از کاربر اجازه می‌گیرد.
if ($SelfTest) {
  $fail = 0
  function Report([string]$name, [bool]$ok, [string]$detail, [string]$fix) {
    if (-not $ok) { $script:stFail++ }
    $mark = if ($ok) { 'سالم ' } else { 'خطا  ' }
    Write-Host ("  $mark $name") -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' })
    if ($detail) { Write-Host "         $detail" -ForegroundColor Gray }
    if (-not $ok -and $fix) { Write-Host "         راهکار: $fix" -ForegroundColor Yellow }
  }
  $script:stFail = 0

  Write-Host ''
  Write-Host '  بررسی عملکرد — هیچ صدایی ضبط، ذخیره یا فرستاده نمی‌شود' -ForegroundColor Cyan
  Write-Host '  ----------------------------------------------------' -ForegroundColor DarkGray
  Write-Host ("  پیکربندی: مدل $Model · زبان $Language · نرخ $rate هرتز") -ForegroundColor DarkGray
  Write-Host ''

  # ۱ — میکروفون
  $devs = [WaveRec]::DeviceCount
  if ($devs -eq 0) {
    Report 'دسترسی میکروفون' $false 'هیچ دستگاه ورودی‌ای پیدا نشد.' `
      'میکروفون را وصل کنید و در «تنظیمات صدا»ی ویندوز فعالش کنید. اگر Privacy میکروفون را بسته، از Settings → Privacy → Microphone بازش کنید.'
  } else {
    $probe = New-Object WaveRec
    try {
      $probe.Start($rate, 1)
      Report 'دسترسی میکروفون' $true "$devs دستگاه؛ قالب $rate هرتز، تک‌کاناله، ۱۶ بیتی پذیرفته شد." ''
    } catch {
      Report 'دسترسی میکروفون' $false $_.Exception.Message `
        'برنامهٔ دیگری میکروفون را در اختیار گرفته است، یا درایور این قالب را رد می‌کند.'
    } finally { $probe.Free() }
  }

  # ۲ — ثبت کلید میان‌بر
  try {
    $hk = ConvertTo-Hotkey $Hotkey
    $free = [Native]::RegisterHotKey([IntPtr]::Zero, 99, ($hk.Mods -bor 0x4000), $hk.Vk)
    if ($free) { [Native]::UnregisterHotKey([IntPtr]::Zero, 99) | Out-Null }
    $stored = Get-StoredSettings
    $where = if ($stored -and $stored.hotkey) { 'از تنظیمات.json' } else { 'پیش‌فرض' }

    # اگر ثبت نشد، ممکن است خودِ ابزار در حال اجرا باشد و میان‌بر دستش باشد —
    # که سلامت است، نه خطا. با همان mutex تک‌نمونه تفکیکش می‌کنیم.
    $mine = $false
    if (-not $free) {
      $m = New-Object System.Threading.Mutex($false, 'faVoiceTypeSingleInstance')
      try { $mine = -not $m.WaitOne(0) } finally {
        if (-not $mine) { try { $m.ReleaseMutex() } catch { } }
        $m.Dispose()
      }
    }
    if ($mine) {
      Report 'ثبت کلید میان‌بر' $true "$($hk.Label) — $where؛ در اختیار نمونهٔ در حال اجرای خودِ ابزار." ''
    } else {
      Report 'ثبت کلید میان‌بر' $free "$($hk.Label) — $where" `
        'برنامهٔ دیگری این ترکیب را گرفته است. «میان‌بر.cmd» را اجرا کنید و ترکیب دیگری انتخاب کنید.'
    }
  } catch {
    Report 'ثبت کلید میان‌بر' $false $_.Exception.Message 'قالب میان‌بر را در «میان‌بر.cmd» دوباره انتخاب کنید.'
  }

  # ۳ — شروع و توقف ضبط (بدون ذخیره و بدون ارسال)
  if ($devs -gt 0) {
    $probe2 = New-Object WaveRec
    try {
      $probe2.Start($rate, 2)
      Start-Sleep -Milliseconds 350
      $got = $probe2.LiveLevel(250)
      $probe2.Free()
      Report 'شروع و توقف ضبط' $true ("چرخهٔ باز/خواندن/بستن انجام شد؛ سطح لحظه‌ای خوانده شد: " +
        [Math]::Round($got * 100, 2) + '٪. هیچ فایلی نوشته نشد.') ''
    } catch {
      try { $probe2.Free() } catch { }
      Report 'شروع و توقف ضبط' $false $_.Exception.Message 'همان علت‌های بررسی میکروفون.'
    }
  } else {
    Report 'شروع و توقف ضبط' $false 'بدون میکروفون قابل آزمودن نیست.' 'اول بررسی یکم را درست کنید.'
  }

  # ۴ — اتصال به سرویس تبدیل گفتار (بدون فرستادن صدا)
  if (-not (Test-Path $keyFile)) {
    Report 'اتصال به Deepgram' $false 'کلیدی ذخیره نشده است.' `
      'در تنظیمات اپ وب دکمهٔ «راه‌اندازی تایپ صوتی» را بزنید، یا «تایپ-صوتی.cmd -SaveKey».'
  } else {
    $k = Get-DeepgramKey
    $t = Test-DeepgramKey $k
    $k = $null
    Report 'اتصال به Deepgram' $t.Ok $(if ($t.Ok) { "کلید پذیرفته شد؛ $($t.Projects) پروژه. مسیر /projects — صدا فرستاده نشد." } else { $t.Message }) `
      'اگر کشورِ آی‌پی پشتیبانی نمی‌شود، گرهٔ VPN را روی آلمان بگذارید. اگر کلید رد شد، با -ResetKey دوباره واردش کنید.'
  }

  # واژه‌نامه — اطلاعی، نه بررسی
  $terms = @(Get-Glossary)
  Write-Host ''
  Write-Host ("  واژه‌نامه: $($terms.Count) اصطلاح" + $(if ($terms.Count) { ' — ' + ($terms -join '، ') } else { ' (فایل: ' + $glossFile + ')' })) -ForegroundColor DarkGray

  Write-Host ''
  if ($script:stFail -eq 0) {
    Write-Host '  هر چهار بررسی سالم است.' -ForegroundColor Green
    Write-Host '  برای آزمودن واقعیِ گفتار (که صدا را به Deepgram می‌فرستد): «عیب-یابی.cmd»' -ForegroundColor DarkGray
  } else {
    Write-Host "  $($script:stFail) بررسی خطا داد — راهکارها بالا آمده." -ForegroundColor Red
  }
  Write-Host ''
  exit $(if ($script:stFail) { 1 } else { 0 })
}

$key = Get-DeepgramKey

if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Force $dataDir | Out-Null }
if (-not (Test-Path $glossFile)) {
  @(
    '# نام‌ها و اصطلاحاتی که مدام غلط شنیده می‌شوند — یکی در هر خط یا جداشده با ویرگول.',
    '# این فهرست به Deepgram می‌رود (keyterm)، نه به‌صورت جمله.',
    '# خط‌هایی که با # شروع شوند نادیده گرفته می‌شوند.'
  ) | Set-Content -Path $glossFile -Encoding UTF8
}

# ——— فقط یک نمونه ———
# دو نمونه سرِ یک میان‌بر دعوا می‌کنند: دومی ثبت نمی‌شود و اولی هم ممکن است
# گیر کرده باشد. از بیرون فقط این دیده می‌شود که میان‌بر جواب نمی‌دهد —
# همین یک بار پیش آمد و تشخیصش سخت بود.
$mutex = New-Object System.Threading.Mutex($false, 'faVoiceTypeSingleInstance')
if (-not $mutex.WaitOne(0)) {
  Write-Host ''
  Write-Host '  یک نمونه از تایپ صوتی همین حالا در حال اجراست.' -ForegroundColor Yellow
  Write-Host '  آن پنجره را از نوار وظیفه ببندید، بعد دوباره اجرا کنید.' -ForegroundColor Yellow
  Write-Host ''
  exit 1
}

$MOD_NOREPEAT = 0x4000   # نگه‌داشتن کلید نباید پشت‌سرهم شلیک کند
$HOTKEY_ID = 1; $WM_HOTKEY = 0x0312; $PM_REMOVE = 1

$hk = ConvertTo-Hotkey $Hotkey
if (-not [Native]::RegisterHotKey([IntPtr]::Zero, $HOTKEY_ID, ($hk.Mods -bor $MOD_NOREPEAT), $hk.Vk)) {
  Write-Host ''
  Write-Host "  ثبت میان‌بر $($hk.Label) ممکن نشد — برنامهٔ دیگری آن را گرفته است." -ForegroundColor Red
  Write-Host '  این ترکیب‌ها همین حالا آزادند:' -ForegroundColor Yellow
  $probeId = 90
  foreach ($alt in @('Ctrl+Shift+Space','Ctrl+Alt+V','Ctrl+Shift+V','Ctrl+Alt+M','Ctrl+Alt+Q','Alt+Shift+V','Ctrl+Alt+F9')) {
    $probeId++
    $a = ConvertTo-Hotkey $alt
    if ([Native]::RegisterHotKey([IntPtr]::Zero, $probeId, ($a.Mods -bor $MOD_NOREPEAT), $a.Vk)) {
      [Native]::UnregisterHotKey([IntPtr]::Zero, $probeId) | Out-Null
      Write-Host "     $alt" -ForegroundColor Green
    }
  }
  Write-Host ''
  Write-Host '  مثال:  تایپ-صوتی.cmd -Hotkey "Ctrl+Alt+M"' -ForegroundColor Gray
  exit 1
}

Write-Host ''
Write-Host "  $($hk.Label)  ->  شروع ضبط  (دو بوق بالارونده)" -ForegroundColor White
Write-Host "  $($hk.Label)  ->  پایان، رونویسی و چسباندن"      -ForegroundColor White
Write-Host ''
Write-Host "  مدل: $Model   زبان: $Language" -ForegroundColor DarkGray
Write-Host "  واژه‌نامه: $glossFile" -ForegroundColor DarkGray
if ($NoPaste) { Write-Host '  حالت: فقط کلیپ‌بورد (بدون Ctrl+V)' -ForegroundColor DarkGray }
Write-Host ''
Write-Host '  عوض کردن میان‌بر: دابل‌کلیک روی «میان‌بر.cmd»' -ForegroundColor DarkGray
Write-Host '  این پنجره باید باز بماند. برای پایان: Ctrl+C' -ForegroundColor DarkGray
Write-Host ''

# پنجره را کوچک می‌کنیم، وگرنه SendKeys در همین کنسول می‌چسباند نه در چت‌باکس
if (-not $Show) {
  Start-Sleep -Milliseconds 1200
  [Native]::ShowWindow([Native]::GetConsoleWindow(), 6) | Out-Null
}

$recording = $false
$target    = [IntPtr]::Zero
$startedAt = $null
$msg = New-Object NativeMsg

try {
  while ($true) {
    $fired = $false
    while ([Native]::PeekMessage([ref]$msg, [IntPtr]::Zero, 0, 0, $PM_REMOVE)) {
      if ($msg.message -eq $WM_HOTKEY) { $fired = $true }
    }

    # ——— توقف خودکار روی سکوت ———
    # طرح اولیه دو بار زدن می‌خواست و کاربر یک بار می‌زد: ضبط تا سقف ادامه
    # پیدا می‌کرد و Deepgram روی آن‌همه سکوت چیزی برنمی‌گرداند. حالا مثل
    # recorder.js، ساکت شدن گوینده پایانِ ضبط است.
    $autoStop = $false
    if ($recording -and $script:rec) {
      $elapsed = ((Get-Date) - $startedAt).TotalSeconds
      # نیم‌ثانیهٔ اول نادیده گرفته می‌شود: دنبالهٔ بوق و بازتاب بلندگو
      if ($elapsed -ge 0.5) {
        $lvl = $script:rec.LiveLevel(250)
        if ($lvl -ge $quietPeak) {
          $script:loudRun++
          # یک تک‌ضربه (کلیک ماوس، برخورد به میز) گفتار نیست
          if ($script:loudRun -ge 2) { $script:spoke = $true }
          $script:quietAt = $null
        } else {
          $script:loudRun = 0
          if ($script:spoke) {
            if (-not $script:quietAt) { $script:quietAt = Get-Date }
            elseif (((Get-Date) - $script:quietAt).TotalSeconds -ge $AutoStopSeconds) { $autoStop = $true }
          } elseif ($elapsed -ge $NoSpeechSeconds) {
            # هیچ‌وقت حرفی نیامد؛ بیهوده تا سقف ضبط نکنیم
            $script:noSpeech = $true
            $autoStop = $true
          }
        }
      }
    }

    # سقف ایمنی: ضبطی که کاربر فراموشش کرده، خودش تمام می‌شود
    $timedOut = $recording -and ((Get-Date) - $startedAt).TotalSeconds -ge $MaxSeconds

    if ($fired -or $timedOut -or $autoStop) {
      if (-not $recording) {
        $target = [Native]::GetForegroundWindow()
        # چسباندن در کنسول خودمان بی‌معنی است؛ اگر فوکوس همین‌جا بود، مقصد
        # را رها می‌کنیم تا SendKeys به هر پنجره‌ای که آن لحظه جلوست برود.
        if ($target -eq [Native]::GetConsoleWindow()) { $target = [IntPtr]::Zero }
        try {
          # بوق پیش از شروع ضبط پخش می‌شود، نه بعدش: بلندگو آن را در میکروفون
          # می‌ریخت (اوج ۹۹٪) و تشخیص‌دهندهٔ گفتار بوق را «حرف» می‌گرفت. بعد
          # سکوتِ آمادگیِ کاربر ضبط را می‌بست پیش از آنکه چیزی بگوید.
          Beep-Start
          Start-Recording
          $recording = $true
          $startedAt = Get-Date
          $script:spoke = $false     # تا اولین گفتار، سکوت پایان حساب نمی‌شود
          $script:quietAt = $null
          $script:loudRun = 0
          $script:noSpeech = $false
          Write-Line ('در حال شنیدن…   مقصد: ' + (Get-WindowTitle $target)) 'Cyan'
        } catch {
          Beep-Fail
          Write-Line $_.Exception.Message 'Red'
        }
      } else {
        $recording = $false
        if ($timedOut)  { Write-Line "سقف $MaxSeconds ثانیه — ضبط خودکار بسته شد." 'DarkYellow' }
        elseif ($script:noSpeech) { Write-Line "$NoSpeechSeconds ثانیه گذشت و حرفی نیامد — ضبط بسته شد." 'DarkYellow' }
        elseif ($autoStop) { Write-Line 'سکوت — ضبط خودش تمام شد.' 'DarkGray' }
        Beep-Stop
        try {
          Stop-Recording
          $secs = [Math]::Round(((Get-Date) - $startedAt).TotalSeconds, 1)
          $amp = if ($script:lastGain -gt 1.05) { ' تقویت ' + [Math]::Round($script:lastGain, 1) + '×' } else { '' }
          Write-Line ("$secs ثانیه، بلندی " + [Math]::Round($script:lastRms * 100, 2) + "٪$amp — در حال رونویسی…")
          $text = (Invoke-Transcribe $key).Trim()
          if ($text) {
            # شمار کلمه در گزارش می‌رود، نه خودِ متن: محتوای کاربر در لاگ نمی‌ماند.
            $wc = @($text -split '\s+' | Where-Object { $_ }).Count
            $r = Send-Transcript $text $target
            if ($r.Pasted) {
              Beep-Done
              Write-Line "درج شد — $wc کلمه." 'Green'
            } else {
              Beep-Fail
              Write-Line ("درج نشد ($($r.Reason)) — $wc کلمه در کلیپ‌بورد است؛ با Ctrl+V بچسبانید.") 'DarkYellow'
            }
          } else {
            Beep-Fail
            $rmsPct = [Math]::Round($script:lastRms * 100, 2)
            if ($script:lastRms -lt 0.005) {
              Write-Line ("چیزی شنیده نشد — صدا تقریباً ساکت بود (بلندی $rmsPct٪). " +
                'میکروفون را نزدیک‌تر بگیرید، یا در تنظیمات صدای ویندوز ورودی درست را انتخاب و بلندتر کنید.') 'DarkYellow'
            } else {
              Write-Line ("چیزی شنیده نشد — صدا رسید (بلندی $rmsPct٪) ولی Deepgram کلمه‌ای تشخیص نداد. " +
                'شاید شمرده‌تر و بلندتر حرف زدن کمک کند.') 'DarkYellow'
            }
          }
        } catch {
          Beep-Fail
          Write-Line $_.Exception.Message 'Red'
        }
      }
    }

    Start-Sleep -Milliseconds 40
  }
} finally {
  [Native]::UnregisterHotKey([IntPtr]::Zero, $HOTKEY_ID) | Out-Null
  if ($mutex) { try { $mutex.ReleaseMutex() } catch { }; $mutex.Dispose() }
  if ($script:rec) { try { $script:rec.Free() } catch { } }
  if (Test-Path $wavFile) { Remove-Item $wavFile -Force -ErrorAction SilentlyContinue }
}
