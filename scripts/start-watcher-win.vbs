Set WshShell = CreateObject("WScript.Shell") 
' Run the PowerShell Watcher script hidden
WshShell.Run "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & CreateObject("WScript.Shell").ExpandEnvironmentStrings("%USERPROFILE%") & "\zen-sync\scripts\zen-watch-win.ps1""", 0, False
