#Requires -Version 5.1
<#
.SYNOPSIS
    Setup completo e build do OMNI AGENTS para Windows.

.DESCRIPTION
    Instala automaticamente: Rust, dependencias Node, icones, e gera o
    instalador .exe final.

.PARAMETER DevOnly
    Inicia o servidor de desenvolvimento em vez de gerar o instalador.

.PARAMETER SkipRust
    Pula a verificacao/instalacao do Rust (se ja instalado).

.PARAMETER SkipIcons
    Pula a geracao de icones (se ja existirem).

.EXAMPLE
    # Build completo (gera o .exe instalador)
    powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

    # Modo dev (abre o app para teste)
    powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -DevOnly
#>

param(
    [switch]$DevOnly,
    [switch]$SkipRust,
    [switch]$SkipIcons
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Resolve raiz do projeto
$Root = if ($PSScriptRoot) { Split-Path $PSScriptRoot -Parent } else { $PWD.Path }
Push-Location $Root

# ─── Helpers de output ────────────────────────────────────────────────────────
function Write-Step { param([string]$msg) Write-Host "`n  >> $msg" -ForegroundColor Cyan }
function Write-OK   { param([string]$msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn { param([string]$msg) Write-Host "  [!!] $msg" -ForegroundColor Yellow }
function Write-Fail {
    param([string]$msg)
    Write-Host "`n  [FALHA] $msg" -ForegroundColor Red
    Pop-Location
    exit 1
}

# ─── Geracao de icone padrao via .NET ─────────────────────────────────────────
function New-AppIcon {
    param([string]$OutputPath)

    Add-Type -AssemblyName System.Drawing

    $size   = 512
    $bmp    = New-Object System.Drawing.Bitmap $size, $size
    $g      = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode        = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint    = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    # Fundo escuro
    $bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(14, 14, 20))
    $g.FillRectangle($bgBrush, 0, 0, $size, $size)

    # Quadrado arredondado indigo
    $accentBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(99, 102, 241))
    $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
    $x = 72; $s = 368; $r = 72
    $gp.AddArc($x,           $x,           $r, $r, 180, 90)
    $gp.AddArc($x + $s - $r, $x,           $r, $r, 270, 90)
    $gp.AddArc($x + $s - $r, $x + $s - $r, $r, $r,   0, 90)
    $gp.AddArc($x,           $x + $s - $r, $r, $r,  90, 90)
    $gp.CloseFigure()
    $g.FillPath($accentBrush, $gp)

    # Letra "O" (OMNI) centralizada
    $font   = New-Object System.Drawing.Font("Segoe UI", 300, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $white  = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $sf     = New-Object System.Drawing.StringFormat
    $sf.Alignment     = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect   = New-Object System.Drawing.RectangleF($x, $x, $s, $s)
    $g.DrawString("O", $font, $white, $rect, $sf)

    $bmp.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $g.Dispose(); $bmp.Dispose(); $font.Dispose()
    $bgBrush.Dispose(); $accentBrush.Dispose(); $white.Dispose(); $gp.Dispose()
}

# ─────────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Magenta
Write-Host "   OMNI AGENTS - Setup e Build Completo       " -ForegroundColor Magenta
Write-Host "  ============================================" -ForegroundColor Magenta
Write-Host ""

# ─── 1. Node.js ───────────────────────────────────────────────────────────────
Write-Step "Verificando Node.js..."
$nodeBin = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeBin) {
    Write-Fail "Node.js nao encontrado. Instale em https://nodejs.org (versao 18+) e tente novamente."
}
$nodeVer = node --version
Write-OK "Node.js $nodeVer"

# ─── 2. Rust ──────────────────────────────────────────────────────────────────
if (-not $SkipRust) {
    Write-Step "Verificando Rust..."
    $rustBin = Get-Command rustc -ErrorAction SilentlyContinue

    if (-not $rustBin) {
        Write-Warn "Rust nao encontrado. Instalando via rustup automaticamente..."
        Write-Warn "Isso pode levar 5-10 minutos dependendo da sua conexao."

        $installer = "$env:TEMP\rustup-init.exe"
        $url = "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe"

        Write-Step "Baixando rustup-init.exe de static.rust-lang.org..."
        try {
            Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing
        } catch {
            Write-Fail "Falha ao baixar rustup. Verifique sua conexao ou instale manualmente em https://rustup.rs"
        }

        Write-Step "Instalando Rust (toolchain stable, perfil minimal)..."
        & $installer `
            --default-host x86_64-pc-windows-msvc `
            --default-toolchain stable `
            --profile minimal `
            -y

        if ($LASTEXITCODE -ne 0) {
            Write-Fail "Instalacao do Rust falhou (codigo $LASTEXITCODE). Instale manualmente em https://rustup.rs"
        }

        # Atualiza PATH na sessao atual
        $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
        Remove-Item $installer -ErrorAction SilentlyContinue

        $rustBin = Get-Command rustc -ErrorAction SilentlyContinue
        if (-not $rustBin) {
            Write-Fail "Rust instalado mas 'rustc' nao encontrado no PATH. Feche este terminal, reabra e execute o script novamente."
        }

        Write-OK "Rust instalado com sucesso"
    }

    $rustVer = rustc --version
    Write-OK $rustVer
}

# ─── 3. Visual Studio Build Tools (aviso) ─────────────────────────────────────
Write-Step "Verificando MSVC linker..."
$clBin = Get-Command cl -ErrorAction SilentlyContinue
if (-not $clBin) {
    Write-Warn "cl.exe (MSVC) nao encontrado no PATH."
    Write-Warn "Se o build Rust falhar com 'link.exe not found', instale o Visual Studio Build Tools:"
    Write-Warn "  winget install Microsoft.VisualStudio.2022.BuildTools"
    Write-Warn "  (selecione 'Desenvolvimento para desktop com C++' durante a instalacao)"
    Write-Warn "Continuando mesmo assim..."
} else {
    Write-OK "MSVC linker disponivel"
}

# ─── 4. npm install ───────────────────────────────────────────────────────────
Write-Step "Instalando dependencias Node.js (npm install)..."
npm install
if ($LASTEXITCODE -ne 0) { Write-Fail "npm install falhou." }
Write-OK "Dependencias Node instaladas"

# ─── 5. Icones ────────────────────────────────────────────────────────────────
if (-not $SkipIcons) {
    $iconsDir = "src-tauri\icons"
    $icoFile  = "$iconsDir\icon.ico"

    if (-not (Test-Path $icoFile)) {
        Write-Step "Gerando icones do aplicativo..."

        # Arte oficial na raiz do repo. New-AppIcon so entra como plano B, em
        # clone incompleto: o placeholder "O" nao e a marca final do app.
        # Sem travessao neste arquivo: ele nao tem BOM, o PS 5.1 le como ANSI e
        # o "-" vira aspa curva, que FECHA a string e quebra o parser.
        $artIcon  = "$Root\app-icon.png"
        $tempIcon = $null

        try {
            if (Test-Path $artIcon) {
                $sourceIcon = $artIcon
                Write-OK "Usando a arte do app: app-icon.png"
            } else {
                $tempIcon = "$Root\icon-source-temp.png"
                New-AppIcon -OutputPath $tempIcon
                $sourceIcon = $tempIcon
                Write-Warn "app-icon.png nao encontrado. Gerando placeholder 512x512."
            }

            npx tauri icon $sourceIcon
            if ($LASTEXITCODE -ne 0) {
                Write-Warn "Geracao de icones pelo Tauri falhou. O build de desenvolvimento ainda funciona sem icones."
            } else {
                Write-OK "Todos os tamanhos de icone gerados em $iconsDir"
            }
        } finally {
            if ($tempIcon) { Remove-Item $tempIcon -ErrorAction SilentlyContinue }
        }
    } else {
        Write-OK "Icones ja existem em $iconsDir"
    }
}

# ─── 6. Build final ───────────────────────────────────────────────────────────
if ($DevOnly) {
    Write-Step "Iniciando modo de desenvolvimento..."
    Write-OK "O aplicativo Tauri sera aberto em uma janela nativa."
    Write-Host ""
    npx tauri dev
} else {
    Write-Step "Compilando aplicativo Tauri..."
    Write-Warn "PRIMEIRA compilacao Rust: pode levar alguns minutos (compilando os crates)."
    Write-Warn "Compilacoes seguintes sao muito mais rapidas."
    Write-Host ""

    npx tauri build
    if ($LASTEXITCODE -ne 0) { Write-Fail "Build do Tauri falhou. Veja os erros acima." }

    # Localiza os artefatos gerados
    $bundle = "src-tauri\target\release\bundle"
    $nsisExe = Get-ChildItem "$bundle\nsis\*-setup.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    $msiFile  = Get-ChildItem "$bundle\msi\*.msi"       -ErrorAction SilentlyContinue | Select-Object -First 1

    Write-Host ""
    Write-Host "  ============================================" -ForegroundColor Green
    Write-Host "        BUILD CONCLUIDO COM SUCESSO!         " -ForegroundColor Green
    Write-Host "  ============================================" -ForegroundColor Green
    Write-Host ""

    if ($nsisExe) {
        Write-Host "  Instalador .exe:" -ForegroundColor White
        Write-Host "    $($nsisExe.FullName)" -ForegroundColor Yellow
        Write-Host ""
    }
    if ($msiFile) {
        Write-Host "  Instalador .msi:" -ForegroundColor White
        Write-Host "    $($msiFile.FullName)" -ForegroundColor Yellow
        Write-Host ""
    }

    Write-Host "  Execute o instalador para instalar o OMNI AGENTS." -ForegroundColor White
    Write-Host "  O usuario final nao precisa de Python ou Rust." -ForegroundColor Cyan
    Write-Host ""

    # Abre a pasta do bundle no Explorer automaticamente
    if (Test-Path $bundle) {
        Write-Step "Abrindo pasta do instalador no Explorer..."
        Start-Process "explorer.exe" -ArgumentList $bundle
    }
}

Pop-Location
