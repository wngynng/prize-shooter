# ============================================================
# 《夜市神枪手》单文件打包脚本
# 用法：powershell -File build-mobile.ps1
# 产物：dist\夜市神枪手-手机版.html（零外部依赖，发送到手机即可玩）
# ============================================================
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$enc = New-Object System.Text.UTF8Encoding($false)

# 读取源文件（.NET API 保证 UTF-8 无乱码）
$css = [IO.File]::ReadAllText((Join-Path $root 'css\style.css'))
$js  = [IO.File]::ReadAllText((Join-Path $root 'js\config.js')) + "`n" +
       [IO.File]::ReadAllText((Join-Path $root 'js\game.js'))    + "`n" +
       [IO.File]::ReadAllText((Join-Path $root 'js\main.js'))
$html = [IO.File]::ReadAllText((Join-Path $root 'index.html'))

# 内联（String.Replace 为字面替换，不受正则/变量插值影响）
$html = $html.Replace('<link rel="stylesheet" href="css/style.css">', "<style>`n$css`n</style>")
$html = $html.Replace('<script src="js/config.js"></script>', "<script>`n$js`n</script>")
$html = $html.Replace('<script src="js/game.js"></script>', '')
$html = $html.Replace('<script src="js/main.js"></script>', '')

# 校验：产物不应再引用任何外部文件
if ($html -match '(src|href)="(?!#)') { throw 'pack failed: external refs remain' }

$out = Join-Path $outDir '夜市神枪手-手机版.html'
[IO.File]::WriteAllText($out, $html, $enc)
$kb = [math]::Round((Get-Item $out).Length / 1KB, 1)
Write-Host "OK: $out ($kb KB)"
