$ws = New-Object -ComObject WScript.Shell
$desk = [Environment]::GetFolderPath('Desktop')
$startMenu = [Environment]::GetFolderPath('Programs')
$targetBat = 'E:\tool edit\subtitle-localizer-studio\start_studio.bat'
$workDir = 'E:\tool edit\subtitle-localizer-studio'

# 1. Tao shortcut tren Desktop
$scDesk = $ws.CreateShortcut((Join-Path $desk 'Subtitle Localizer Studio.lnk'))
$scDesk.TargetPath = $targetBat
$scDesk.WorkingDirectory = $workDir
$scDesk.Description = 'Khoi dong Subtitle Localizer Studio (Ctrl+Alt+L)'
$scDesk.Hotkey = 'Ctrl+Alt+L'
$scDesk.IconLocation = "$env:SystemRoot\System32\shell32.dll,115"
$scDesk.Save()

# 2. Tao shortcut trong Start Menu Programs (Windows hook hotkey cuc ky nhay tu thu muc nay)
$scMenu = $ws.CreateShortcut((Join-Path $startMenu 'Subtitle Localizer Studio.lnk'))
$scMenu.TargetPath = $targetBat
$scMenu.WorkingDirectory = $workDir
$scMenu.Description = 'Khoi dong Subtitle Localizer Studio (Ctrl+Alt+L)'
$scMenu.Hotkey = 'Ctrl+Alt+L'
$scMenu.IconLocation = "$env:SystemRoot\System32\shell32.dll,115"
$scMenu.Save()

Write-Output "1. Da tao shortcut tai Desktop: $desk"
Write-Output "2. Da tao shortcut tai Start Menu: $startMenu"

# 3. Restart Windows Explorer de reload hotkey table
Write-Output "3. Dang khoi dong lai Windows Explorer de nap phim tat..."
Stop-Process -Name explorer -Force
Start-Sleep -Seconds 1
Start-Process explorer.exe
Write-Output "SUCCESS: Explorer da restart xong! Phim tat Ctrl+Alt+L da san sang hoat dong."