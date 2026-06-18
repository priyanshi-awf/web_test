param(
  [string]$Version = '18.19.0',
  [ValidateSet('win-x64','win-x86')] [string]$Arch = 'win-x64'
)

$zip = "$env:USERPROFILE\node.zip"
$destRoot = "$env:USERPROFILE\nodejs"
$url = "https://nodejs.org/dist/v$Version/node-v$Version-$Arch.zip"

Write-Host "Node portable installer"
Write-Host "Version: $Version  Arch: $Arch"
Write-Host "Download URL: $url"

Function Try-Download {
  param($url,$out)
  try {
    Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -ErrorAction Stop
    return $true
  } catch {
    Try {
      Start-BitsTransfer -Source $url -Destination $out -ErrorAction Stop
      return $true
    } catch {
      return $false
    }
  }
}

# create dest folder
if (-not (Test-Path $destRoot)) { New-Item -Path $destRoot -ItemType Directory | Out-Null }

Write-Host "Downloading Node to $zip..."
$ok = Try-Download -url $url -out $zip
if (-not $ok) {
  Write-Host "Automatic download failed. Please download manually from:`n$url`nthen extract contents into $destRoot\node and re-run this script (or set PATH manually)." -ForegroundColor Yellow
  exit 1
}

Write-Host "Extracting..."
Expand-Archive -Path $zip -DestinationPath $destRoot -Force

$extractedFolder = Join-Path $destRoot (Get-ChildItem -Path $destRoot -Directory | Where-Object { $_.Name -like "node-v$Version*" } | Select-Object -First 1).Name
if ($extractedFolder) {
  $finalNodePath = Join-Path $destRoot 'node'
  if (Test-Path $finalNodePath) { Remove-Item -Recurse -Force $finalNodePath }
  Move-Item -Force (Join-Path $destRoot $extractedFolder) $finalNodePath
} else {
  Write-Host "Warning: couldn't detect extracted folder. Ensure $destRoot contains a 'node' folder with node.exe" -ForegroundColor Yellow
  $finalNodePath = Join-Path $destRoot 'node'
}

# add to user PATH
$userPath = [Environment]::GetEnvironmentVariable('Path','User')
if ($userPath -notlike "*$finalNodePath*") {
  [Environment]::SetEnvironmentVariable('Path', ($userPath + ';' + $finalNodePath), 'User')
  Write-Host "Added $finalNodePath to user PATH. This applies to new terminals." -ForegroundColor Green
} else {
  Write-Host "Path already contains $finalNodePath" -ForegroundColor Green
}

# cleanup
Remove-Item $zip -ErrorAction SilentlyContinue

Write-Host "Done. Close this PowerShell window, open a new one, and run:`n  node -v`n  npm -v" -ForegroundColor Cyan

exit 0
