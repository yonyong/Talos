# ============================================================
#  Talos packaging helpers
#
#  Invoked from package-server.bat / package-agent.bat with -File,
#  so the batch files never have to embed quoted PowerShell code
#  (nested quotes inside a for /f command string are a minefield).
#
#    -Task pomver -Path <pom.xml>   print the project version
#    -Task hash   -Path <file>      print the lowercase hex digest
#    -Task eol    -Root <dir>       normalise line endings in the tree
#
#  'eol' matters for a package assembled on Windows and deployed on
#  Linux: a shell script with CRLF endings dies on Linux with
#  "\r: command not found", and a batch file with LF endings can trip
#  cmd.exe's block parser. So the tree is normalised in both
#  directions - shells/yaml to LF, Windows scripts to CRLF.
# ============================================================
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('pomver', 'hash', 'eol')]
  [string]$Task,

  [string]$Path,
  [string]$Root,
  [string]$Algo = 'SHA256'
)

$ErrorActionPreference = 'Stop'

switch ($Task) {

  'pomver' {
    if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { exit 1 }

    # Do NOT use Get-Content -Raw here: the pom is UTF-8, but on a zh-CN
    # host Get-Content guesses the ANSI codepage, turns the Chinese
    # <description> into mojibake and the XML parser then fails on the
    # mangled tag. Decode explicitly - UTF-8 first, ANSI as a fallback.
    $bytes = [IO.File]::ReadAllBytes($Path)
    $doc = $null
    foreach ($enc in @([Text.Encoding]::UTF8, [Text.Encoding]::Default)) {
      try {
        $cand = $enc.GetString($bytes)
        if ($cand.Length -gt 0 -and $cand[0] -eq [char]0xFEFF) { $cand = $cand.Substring(1) }
        $doc = [xml]$cand
        break
      }
      catch { $doc = $null }
    }
    if ($null -eq $doc) { exit 1 }

    $v = $doc.project.version
    if (-not $v) { $v = $doc.project.parent.version }
    if ($v) { Write-Output ("$v".Trim()) } else { exit 1 }
  }

  'hash' {
    if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { exit 1 }
    (Get-FileHash -LiteralPath $Path -Algorithm $Algo).Hash.ToLower()
  }

  'eol' {
    if (-not $Root -or -not (Test-Path -LiteralPath $Root)) { exit 1 }

    # LF group: consumed by Linux tools (shell, yaml) or plain readers
    # CRLF group: consumed by cmd.exe / PowerShell on Windows
    $toLf = @('*.sh', '*.yml', '*.yaml', '*.conf', '*.txt')
    $toCrlf = @('*.bat', '*.cmd', '*.ps1')

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    # strict decoder: throws on bytes that are not valid UTF-8, which
    # is how we detect files written in the local ANSI codepage
    $utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)

    $lfScanned = 0
    $lfChanged = 0
    $crlfScanned = 0
    $crlfChanged = 0

    foreach ($pat in $toLf) {
      foreach ($f in Get-ChildItem -LiteralPath $Root -Recurse -File -Filter $pat -ErrorAction SilentlyContinue) {
        $lfScanned++
        $bytes = [IO.File]::ReadAllBytes($f.FullName)
        try { $text = $utf8Strict.GetString($bytes) }
        catch { $text = [Text.Encoding]::Default.GetString($bytes) }

        $new = $text -replace "`r`n", "`n"
        $new = $new -replace "`r", "`n"

        if ($new -ne $text) {
          [IO.File]::WriteAllBytes($f.FullName, $utf8NoBom.GetBytes($new))
          $lfChanged++
        }
      }
    }

    foreach ($pat in $toCrlf) {
      foreach ($f in Get-ChildItem -LiteralPath $Root -Recurse -File -Filter $pat -ErrorAction SilentlyContinue) {
        $crlfScanned++
        $bytes = [IO.File]::ReadAllBytes($f.FullName)
        try { $text = $utf8Strict.GetString($bytes) }
        catch { $text = [Text.Encoding]::Default.GetString($bytes) }

        $norm = $text -replace "`r`n", "`n"
        $norm = $norm -replace "`r", "`n"
        $new = $norm -replace "`n", "`r`n"

        if ($new -ne $text) {
          [IO.File]::WriteAllBytes($f.FullName, $utf8NoBom.GetBytes($new))
          $crlfChanged++
        }
      }
    }

    Write-Output ("[Talos] eol : LF group {0} scanned / {1} rewritten; CRLF group {2} scanned / {3} rewritten" -f `
      $lfScanned, $lfChanged, $crlfScanned, $crlfChanged)
  }
}
