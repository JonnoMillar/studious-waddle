; Typing tracker — capture daemon.
;
; Logs raw keystroke events (key, shift-state-resolved character where
; possible, timestamp, foreground window title) to a local, plain-text,
; newline-delimited JSON log file, one per day. Does NOT interpret words or
; corrections — that intelligence lives entirely in analysis/analyze.py,
; which runs separately and occasionally. This script's only job is to be
; simple, reliable, and invisible in daily use.
;
; All ~-prefixed hotkeys PASS THE KEY THROUGH UNCHANGED — this script only
; observes, it never blocks or alters your typing.
;
; PRIVACY: this literally is a keylogger. The log files live in ..\data\ next
; to this script, stay on this machine, and are never uploaded anywhere. Use
; PauseHotkey (default: Ctrl+Alt+P) before typing passwords or anything you
; don't want recorded, and ExcludedTitles below to blanket-exclude apps like
; password managers.

#Requires AutoHotkey v2.0
#SingleInstance Force
#InstallKeybdHook
Persistent

; ---- configuration -----------------------------------------------------

PauseHotkey := "^!p"          ; Ctrl+Alt+P toggles logging on/off
DataDir := A_ScriptDir "\..\data"
ExcludedTitles := ["1Password", "Bitwarden", "KeePass", "Windows Security"]

; ---- state ---------------------------------------------------------------

global Paused := false
global CurrentLogFile := ""
global CurrentLogDate := ""

DirCreate(DataDir)

; ---- pause/resume toggle --------------------------------------------------

Hotkey(PauseHotkey, ToggleLog)
ToggleLog(*) {
    global Paused
    Paused := !Paused
    TrayTip("Typing tracker", Paused ? "Paused" : "Resumed", 1)
}

; ---- log file rotation (one file per calendar day) ------------------------

GetLogFile() {
    global CurrentLogFile, CurrentLogDate, DataDir
    today := FormatTime(A_Now, "yyyy-MM-dd")
    if (today != CurrentLogDate) {
        CurrentLogDate := today
        CurrentLogFile := DataDir "\log-" today ".ndjson"
    }
    return CurrentLogFile
}

; ---- the actual logging --------------------------------------------------

IsExcluded(title) {
    global ExcludedTitles
    for needle in ExcludedTitles {
        if InStr(title, needle)
            return true
    }
    return false
}

JsonEscape(s) {
    s := StrReplace(s, "\", "\\")
    s := StrReplace(s, '"', '\"')
    return s
}

LogEvent(kind, value) {
    global Paused
    if Paused
        return
    title := ""
    try title := WinGetTitle("A")
    if IsExcluded(title)
        return
    line := Format(
        '{{"t":{1},"kind":"{2}","v":"{3}","win":"{4}"}}`n',
        A_TickCount, kind, JsonEscape(value), JsonEscape(title)
    )
    try FileAppend(line, GetLogFile(), "UTF-8")
}

; ---- key bindings ----------------------------------------------------
; ~ prefix: observe only, never consume/block the keystroke.

; Letters and digits — GetKeyState tells us the resolved shift state so the
; analyzer sees "A" vs "a" correctly without needing its own keyboard layout.
Loop Parse, "abcdefghijklmnopqrstuvwxyz0123456789", "" {
    key := A_LoopField
    Hotkey("~" key, LogCharKey)
}
LogCharKey(hk) {
    key := SubStr(hk, 2)  ; strip leading ~
    shifted := GetKeyState("Shift")
    LogEvent("char", shifted ? StrUpper(key) : key)
}

; Common punctuation (unshifted key names differ from produced characters;
; log the physical key, the analyzer maps layout->character if needed).
punctKeys := ["-", "=", "[", "]", ";", "'", ",", ".", "/", "``"]
for k in punctKeys
    Hotkey("~" k, ((*) => LogEvent("char", k)))

; Structural / control keys the analyzer needs for word/session boundaries.
~Space::LogEvent("space", " ")
~Enter::LogEvent("enter", "\n")
~Tab::LogEvent("tab", "\t")
~BackSpace::LogEvent("backspace", "")
~Delete::LogEvent("delete", "")
~Left::LogEvent("nav", "left")
~Right::LogEvent("nav", "right")

TrayTip("Typing tracker", "Running. " PauseHotkey " to pause.", 1)
