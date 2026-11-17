#requires -version 5.1
<#
    Make-template: builds "Shablon akta.docx" (Word template with {{PLACEHOLDERS}}) from a sample act,
    then embeds it into js\template-data.js (base64) so the page works from file:// as well.

    Usage:  powershell -ExecutionPolicy Bypass -File make-template.ps1 -Sample "<path to sample act .docx>"
            powershell -ExecutionPolicy Bypass -File make-template.ps1 -EmbedOnly   (only re-embed the existing template)
    (cells are addressed by row/cell index; file saved with BOM)
#>
param([string]$Sample = '', [switch]$EmbedOnly)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = $PSScriptRoot
$tplPath = Join-Path $root 'template_act.docx'

if (-not $EmbedOnly) {
    if (-not $Sample) { throw 'Need -Sample' }
    $tmp = Join-Path $env:TEMP ('actgen_' + [guid]::NewGuid().ToString('N'))
    [IO.Compression.ZipFile]::ExtractToDirectory($Sample, $tmp)
    $docPath = Join-Path $tmp 'word\document.xml'

    $d = New-Object Xml.XmlDocument
    $d.PreserveWhitespace = $true
    $d.Load($docPath)
    $W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    $ns = New-Object Xml.XmlNamespaceManager $d.NameTable
    $ns.AddNamespace('w', $W)

    $rows = @($d.SelectNodes('//w:tr', $ns))
    function Cell($r, $c) { return @($rows[$r].SelectNodes('w:tc', $ns))[$c] }

    # Put $text into paragraph $p: keep the first text run (its formatting), drop the other runs
    function SetText($p, [string]$text) {
        $runs = @($p.SelectNodes('w:r', $ns) | Where-Object { $_.SelectSingleNode('w:t', $ns) })
        if ($runs.Count -eq 0) {
            $r = $d.CreateElement('w', 'r', $W)
            $t = $d.CreateElement('w', 't', $W)
            $r.AppendChild($t) | Out-Null
            $p.AppendChild($r) | Out-Null
            $runs = @($r)
        }
        $first = $runs[0]
        for ($i = 1; $i -lt $runs.Count; $i++) { $p.RemoveChild($runs[$i]) | Out-Null }
        # drop the remaining text/tab-only runs after the first (e.g. a trailing tab)
        foreach ($r in @($p.SelectNodes('w:r', $ns))) { if ($r -ne $first -and -not $r.SelectSingleNode('w:t', $ns)) { $p.RemoveChild($r) | Out-Null } }
        $t = $first.SelectSingleNode('w:t', $ns)
        $t.InnerText = $text
        $a = $d.CreateAttribute('xml', 'space', 'http://www.w3.org/XML/1998/namespace')
        $a.Value = 'preserve'
        $t.Attributes.Append($a) | Out-Null
    }
    function SetCell($r, $c, [string]$text) {
        $p = @((Cell $r $c).SelectNodes('w:p', $ns))[0]
        SetText $p $text
    }

    SetCell 2 1 'Акт №{{ACT_NO}} от {{ACT_DATE}} г.'
    SetCell 4 2 '{{EXECUTOR}}'
    SetCell 6 2 '{{CUSTOMER}}'
    SetCell 8 2 '{{BASIS}}'

    # item row (12)
    SetCell 12 1 '{{ITEM_NO}}'
    SetCell 12 3 '{{ITEM_QTY}}'
    SetCell 12 4 '{{ITEM_UNIT}}'
    SetCell 12 5 '{{ITEM_PRICE}}'
    SetCell 12 6 '{{ITEM_SUM}}'
    # name cell: paragraphs: 0 title, 1 bullet 1, 2 bullet 2, 3 object
    $ps = @((Cell 12 2).SelectNodes('w:p', $ns))
    $title = $ps[0]
    $titleRuns = @($title.SelectNodes('w:r', $ns))
    # "-" + " " + "text": keep the dash, replace text
    $titleRuns[0].SelectSingleNode('w:t', $ns).InnerText = '-'
    $titleRuns[1].SelectSingleNode('w:t', $ns).InnerText = ' '
    $titleRuns[2].SelectSingleNode('w:t', $ns).InnerText = '{{ITEM_TITLE}}'
    # bullet: run0 = bullet char, run1 = tab + text
    $b = $ps[1]
    @($b.SelectNodes('w:r', $ns))[1].SelectSingleNode('w:t', $ns).InnerText = '{{ITEM_LINE}}'
    $null = (Cell 12 2).RemoveChild($ps[2])
    # object paragraph
    $o = $ps[3]
    $oText = [string][char]0x41E + [char]0x431 + [char]0x44A + [char]0x435 + [char]0x43A + [char]0x442 + ': {{OBJECT}}'
    SetText $o $oText

    # totals
    SetCell 14 27 '{{TOTAL}}'
    SetCell 15 23 '{{VAT_LABEL}}'
    SetCell 15 24 '{{VAT_VALUE}}'
    # "Vsego okazano uslug N, na summu X rub."
    $vsego = -join ([char[]](0x412,0x441,0x435,0x433,0x43E,0x20,0x43E,0x43A,0x430,0x437,0x430,0x43D,0x43E,0x20,0x443,0x441,0x43B,0x443,0x433,0x20))
    $nas = -join ([char[]](0x2C,0x20,0x43D,0x430,0x20,0x441,0x443,0x43C,0x43C,0x443,0x20))
    $rub = -join ([char[]](0x20,0x440,0x443,0x431,0x2E))
    SetCell 17 1 ($vsego + '{{COUNT}}' + $nas + '{{TOTAL}}' + $rub)
    SetCell 18 1 '{{TOTAL_WORDS}}'
    SetCell 25 1 '{{EXECUTOR_SIGN}}'
    SetCell 25 5 '{{CUSTOMER_SIGN}}'
    SetCell 27 5 '{{SIGNER}}'

    $settings = New-Object Xml.XmlWriterSettings
    $settings.Encoding = New-Object Text.UTF8Encoding($false)
    $w = [Xml.XmlWriter]::Create($docPath, $settings)
    $d.Save($w)
    $w.Close()

    if (Test-Path $tplPath) { Remove-Item $tplPath -Force }
    # zip with [Content_Types].xml first
    $zip = [IO.Compression.ZipFile]::Open($tplPath, 'Create')
    $files = Get-ChildItem $tmp -Recurse -File
    $ordered = @($files | Where-Object { $_.Name -eq '[Content_Types].xml' }) + @($files | Where-Object { $_.Name -ne '[Content_Types].xml' })
    foreach ($f in $ordered) {
        $rel = $f.FullName.Substring($tmp.Length + 1).Replace('\', '/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $rel, 'Optimal') | Out-Null
    }
    $zip.Dispose()
    Remove-Item $tmp -Recurse -Force
    Write-Host "Template saved: $tplPath" -ForegroundColor Green
}

if (-not (Test-Path $tplPath)) { throw "No template: $tplPath" }
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($tplPath))
$js = "// generated by make-template.ps1 - do not edit by hand`r`nwindow.ACT_TEMPLATE_B64 = '" + $b64 + "';`r`n"
[IO.File]::WriteAllText((Join-Path $root 'js\template-data.js'), $js, (New-Object Text.UTF8Encoding($false)))
Write-Host "Embedded into js\template-data.js ($($b64.Length) chars)" -ForegroundColor Green
