Set WshShell = CreateObject("WScript.Shell") 
' Run the PowerShell script invisible (0 = Hide)
' Arguments: PowerShell.exe, -ExecutionPolicy Bypass -File "path\to\script", 0, True
WshShell.Run "powershell.exe -ExecutionPolicy Bypass -File """ & CreateObject("WScript.Shell").ExpandEnvironmentStrings("%USERPROFILE%") & "\ZenSync\scripts\zen-sync-win.ps1""", 0, False