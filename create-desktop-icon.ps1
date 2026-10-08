# Create / refresh a single Desktop shortcut for BUKA PHOTO PRO.
$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd("\")
$desk = [Environment]::GetFolderPath("Desktop")
$lnkPath = Join-Path $desk "BUKA PHOTO PRO.lnk"
$vbs = Join-Path $root "launch.vbs"
$bat = Join-Path $root "start.bat"
$ico = Join-Path $root "icon.ico"

$Wsh = New-Object -ComObject WScript.Shell
$lnk = $Wsh.CreateShortcut($lnkPath)
if (Test-Path -LiteralPath $vbs) {
  $lnk.TargetPath = "wscript.exe"
  $lnk.Arguments = "`"$vbs`""
} else {
  $lnk.TargetPath = $bat
  $lnk.Arguments = ""
}
$lnk.WorkingDirectory = $root
$lnk.WindowStyle = 7
# Hidden launch — the tray icon is the quit handle.
$lnk.Description = "BUKA PHOTO PRO"
if (Test-Path -LiteralPath $ico) {
  $lnk.IconLocation = "$ico,0"
}
$lnk.Save()
Write-Host "Desktop icon: $lnkPath"
