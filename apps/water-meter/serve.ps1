#requires -version 5.1
<#
    Локальный сервер для разработки и проверки.

    Сама программа сервера НЕ требует: index.html открывается двойным щелчком,
    скрипты подключены обычными <script src>, а они по протоколу file:// работают.
    Сервер нужен там, где file:// неудобен: предпросмотр в панели, отладка через
    инструменты разработчика, проверка с планшета в той же сети.

    Запуск:  powershell -ExecutionPolicy Bypass -File serve.ps1
    Остановка: Ctrl+C
#>

param([int]$Port = 8784)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

$types = @{
    '.html' = 'text/html; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.ico'  = 'image/x-icon'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")

try {
    $listener.Start()
} catch {
    Write-Host "Не удалось занять порт $Port. Возможно, он уже занят." -ForegroundColor Red
    throw
}

Write-Host "Сервер поднят: http://localhost:$Port/  (Ctrl+C — остановить)" -ForegroundColor Green
Write-Host "Корень: $root"

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $path = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath)

    if ($path -eq '/') { $path = '/index.html' }

    # Выход за пределы корня запрещён: сервер отдаёт только свою папку.
    $full = Join-Path $root ($path.TrimStart('/') -replace '/', '\')
    $resolved = $null
    if (Test-Path $full) { $resolved = (Resolve-Path $full).Path }

    # Одна кривая заявка не должна ронять сервер: браузер сам спрашивает
    # favicon.ico, которого нет, и на этом всё останавливалось.
    try {
        if ($resolved -and $resolved.StartsWith($root) -and (Test-Path $resolved -PathType Leaf)) {
            $bytes = [System.IO.File]::ReadAllBytes($resolved)
            $extension = [System.IO.Path]::GetExtension($resolved).ToLower()

            $context.Response.ContentType = if ($types.ContainsKey($extension)) { $types[$extension] } else { 'application/octet-stream' }
            $context.Response.Headers.Add('Cache-Control', 'no-store')
        } else {
            $context.Response.StatusCode = 404
            $context.Response.ContentType = 'text/plain; charset=utf-8'
            $bytes = [System.Text.Encoding]::UTF8.GetBytes("404: $path")
        }

        # ContentLength64 обязателен ДО записи: без него HttpListener считает
        # ответ chunked-запрещённым и валится с ProtocolViolationException.
        $context.Response.ContentLength64 = $bytes.Length
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
        Write-Host "Заявка $path не обработана: $_" -ForegroundColor Yellow
    } finally {
        $context.Response.OutputStream.Close()
    }
}
