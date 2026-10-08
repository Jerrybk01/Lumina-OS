# BUKA PHOTO PRO — local static server + system-tray host (no console).
param([switch]$Console)

if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne "STA") {
  $arg = "-NoProfile -ExecutionPolicy Bypass -STA -File `"$PSCommandPath`""
  if ($Console) { $arg += " -Console" }
  Start-Process -FilePath "powershell.exe" -ArgumentList $arg -WindowStyle $(if ($Console) { "Normal" } else { "Hidden" })
  exit 0
}

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$root = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd("\")
$rootPrefix = $root + [IO.Path]::DirectorySeparatorChar
$lockPath = Join-Path $root "buka-running.txt"
$port = 5177

$mime = @{
  ".html"  = "text/html; charset=utf-8"
  ".js"    = "application/javascript; charset=utf-8"
  ".css"   = "text/css; charset=utf-8"
  ".svg"   = "image/svg+xml"
  ".json"  = "application/json"
  ".png"   = "image/png"
  ".jpg"   = "image/jpeg"
  ".jpeg"  = "image/jpeg"
  ".webp"  = "image/webp"
  ".ico"   = "image/x-icon"
  ".md"    = "text/plain; charset=utf-8"
  ".txt"   = "text/plain; charset=utf-8"
  ".woff"  = "font/woff"
  ".woff2" = "font/woff2"
}

function Start-LuminaListener([int]$p) {
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add("http://127.0.0.1:$p/")
  $listener.Start()
  return $listener
}

function Open-LuminaUrl([string]$u) {
  Start-Process $u | Out-Null
}

$listener = $null
foreach ($tryPort in @($port, 5188, 5199)) {
  try {
    $listener = Start-LuminaListener $tryPort
    $port = $tryPort
    break
  } catch {
    $listener = $null
  }
}

if (-not $listener) {
  $fallback = "http://127.0.0.1:5177/"
  if (Test-Path -LiteralPath $lockPath) {
    $saved = (Get-Content -LiteralPath $lockPath -TotalCount 1 -ErrorAction SilentlyContinue)
    if ($saved) { $fallback = $saved.Trim() }
  }
  Open-LuminaUrl $fallback
  exit 0
}

$url = "http://127.0.0.1:$port/"
Set-Content -LiteralPath $lockPath -Value $url -Encoding ASCII
Open-LuminaUrl $url

$script:ServeRoot = $root
$script:ServePrefix = $rootPrefix
$script:ServeMime = $mime
$script:Listener = $listener

$script:ServerPS = [PowerShell]::Create()
$script:ServerPS.AddScript({
  param($listener, $root, $rootPrefix, $mime)
  while ($listener.IsListening) {
    try {
      $ctx = $listener.GetContext()
    } catch {
      break
    }
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $rel = [Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart("/"))
      if ([string]::IsNullOrWhiteSpace($rel)) { $rel = "index.html" }
      $rel = $rel -replace "/", [IO.Path]::DirectorySeparatorChar
      $path = [IO.Path]::GetFullPath((Join-Path $root $rel))
      if (-not $path.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -and
          -not $path.Equals($root, [StringComparison]::OrdinalIgnoreCase)) {
        $res.StatusCode = 403
      } elseif (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        $res.StatusCode = 404
        $bytes = [Text.Encoding]::UTF8.GetBytes("Not found")
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $ext = [IO.Path]::GetExtension($path).ToLowerInvariant()
        $res.ContentType = $(if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" })
        $bytes = [IO.File]::ReadAllBytes($path)
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      }
    } catch {
      try { $res.StatusCode = 500 } catch { }
    } finally {
      try { $res.OutputStream.Close() } catch { }
    }
  }
}).AddArgument($listener).AddArgument($root).AddArgument($rootPrefix).AddArgument($mime) | Out-Null
$async = $script:ServerPS.BeginInvoke()

$iconPath = Join-Path $root "icon.ico"
$icon = $null
if (Test-Path -LiteralPath $iconPath) {
  $icon = New-Object System.Drawing.Icon($iconPath)
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Text = "BUKA PHOTO PRO"
$notify.Visible = $true
if ($icon) { $notify.Icon = $icon } else { $notify.Icon = [System.Drawing.SystemIcons]::Application }

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = $menu.Items.Add("Open BUKA PHOTO PRO")
$guideItem = $menu.Items.Add("User Guide")
[void]$menu.Items.Add("-")
$exitItem = $menu.Items.Add("Quit")
$notify.ContextMenuStrip = $menu

function Stop-LuminaHost {
  try { $script:Listener.Stop() } catch { }
  try { $script:Listener.Close() } catch { }
  try { $script:ServerPS.Stop() } catch { }
  $notify.Visible = $false
  $notify.Dispose()
  if ($icon) { $icon.Dispose() }
  Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
  [System.Windows.Forms.Application]::Exit()
}

$openItem.add_Click({ Open-LuminaUrl $url })
$guideItem.add_Click({ Open-LuminaUrl ($url.TrimEnd("/") + "/guide.html") })
$exitItem.add_Click({ Stop-LuminaHost })
$notify.add_DoubleClick({ Open-LuminaUrl $url })

$notify.BalloonTipTitle = "BUKA PHOTO PRO"
$notify.BalloonTipText = "Running. Right-click this tray icon to quit."
$notify.ShowBalloonTip(4000)

if ($Console) {
  Write-Host ""
  Write-Host "  BUKA PHOTO PRO"
  Write-Host "  $url"
  Write-Host "  Close the tray icon (near the clock) to quit."
  Write-Host ""
}

[System.Windows.Forms.Application]::Run()
try { $script:ServerPS.EndInvoke($async) } catch { }
$script:ServerPS.Dispose()
Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
