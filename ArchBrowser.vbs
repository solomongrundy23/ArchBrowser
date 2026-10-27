' Тихий запуск ArchBrowser без окна консоли.
Option Explicit
Dim sh, fso, base, target, folder, file
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = base

target = base & "\node_modules\electron\dist\electron.exe"
If fso.FileExists(target) Then
  sh.Run """" & target & """ """ & base & """", 0, False
  WScript.Quit 0
End If

' Исходники без node_modules: сначала распакованная сборка (без %TEMP%).
target = base & "\dist\win-unpacked\ArchBrowser.exe"
If fso.FileExists(target) Then
  sh.Run """" & target & """", 0, False
  WScript.Quit 0
End If

' Затем готовая portable-сборка.
folder = base & "\dist"
If fso.FolderExists(folder) Then
  For Each file In fso.GetFolder(folder).Files
    If LCase(Left(file.Name, 12)) = "archbrowser-" And LCase(Right(file.Name, 13)) = "-portable.exe" Then
      sh.Run """" & file.Path & """", 0, False
      WScript.Quit 0
    End If
  Next
End If

MsgBox "Не найден ни Electron, ни portable-сборка ArchBrowser." & vbCrLf & vbCrLf & _
       "Установите зависимости командой npm install или положите" & vbCrLf & _
       "ArchBrowser-*-portable.exe в папку dist." & vbCrLf & vbCrLf & _
       "Журнал запуска: %APPDATA%\ArchBrowser\startup.log", _
       vbExclamation, "ArchBrowser не запускается"
WScript.Quit 1
