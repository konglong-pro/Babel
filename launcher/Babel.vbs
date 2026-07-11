Option Explicit

Dim shell
Dim fileSystem
Dim scriptDirectory
Dim command
Dim exitCode

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File " _
    & Chr(34) & scriptDirectory & "\Babel.ps1" & Chr(34)

exitCode = shell.Run(command, 1, True)
WScript.Quit exitCode
