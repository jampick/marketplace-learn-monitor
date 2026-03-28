param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\teamsapp\assets"),
    [string]$SourceImagePath = (Join-Path $PSScriptRoot "..\app logo.png")
)

Add-Type -AssemblyName System.Drawing

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

if (-not (Test-Path -LiteralPath $SourceImagePath)) {
    throw "Source image not found: $SourceImagePath"
}

function Get-FitRectangle {
    param(
        [int]$CanvasSize,
        [int]$ImageWidth,
        [int]$ImageHeight,
        [double]$PaddingRatio = 0.08
    )

    $padding = [int][Math]::Round($CanvasSize * $PaddingRatio, 0)
    $availableWidth = $CanvasSize - ($padding * 2)
    $availableHeight = $CanvasSize - ($padding * 2)
    $scale = [Math]::Min($availableWidth / $ImageWidth, $availableHeight / $ImageHeight)
    $targetWidth = [int][Math]::Round($ImageWidth * $scale, 0)
    $targetHeight = [int][Math]::Round($ImageHeight * $scale, 0)
    $offsetX = [int][Math]::Round(($CanvasSize - $targetWidth) / 2, 0)
    $offsetY = [int][Math]::Round(($CanvasSize - $targetHeight) / 2, 0)

    return New-Object System.Drawing.Rectangle($offsetX, $offsetY, $targetWidth, $targetHeight)
}

function New-BaseBitmap {
    param(
        [int]$Size
    )

    $bitmap = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)

    return @{
        Bitmap = $bitmap
        Graphics = $graphics
    }
}

function Get-BackgroundColor {
    param(
        [System.Drawing.Bitmap]$Bitmap
    )

    $samples = @(
        $Bitmap.GetPixel(0, 0),
        $Bitmap.GetPixel($Bitmap.Width - 1, 0),
        $Bitmap.GetPixel(0, $Bitmap.Height - 1),
        $Bitmap.GetPixel($Bitmap.Width - 1, $Bitmap.Height - 1)
    )

    return $samples |
        Group-Object { "$($_.R),$($_.G),$($_.B),$($_.A)" } |
        Sort-Object Count -Descending |
        Select-Object -First 1 |
        ForEach-Object {
            $parts = $_.Name.Split(",")
            [System.Drawing.Color]::FromArgb([int]$parts[3], [int]$parts[0], [int]$parts[1], [int]$parts[2])
        }
}

function Test-IsBackgroundPixel {
    param(
        [System.Drawing.Color]$Pixel,
        [System.Drawing.Color]$BackgroundColor
    )

    if ($Pixel.A -lt 24) {
        return $true
    }

    $distance = [Math]::Abs($Pixel.R - $BackgroundColor.R) +
        [Math]::Abs($Pixel.G - $BackgroundColor.G) +
        [Math]::Abs($Pixel.B - $BackgroundColor.B)

    return $distance -lt 36
}

$sourceImage = [System.Drawing.Image]::FromFile($SourceImagePath)

try {
    $colorCanvas = New-BaseBitmap -Size 192
    try {
        $colorRect = Get-FitRectangle -CanvasSize 192 -ImageWidth $sourceImage.Width -ImageHeight $sourceImage.Height
        $colorCanvas.Graphics.DrawImage($sourceImage, $colorRect)
        $colorCanvas.Bitmap.Save((Join-Path $OutputDirectory "color.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $colorCanvas.Graphics.Dispose()
        $colorCanvas.Bitmap.Dispose()
    }

    $outlineCanvas = New-BaseBitmap -Size 32
    try {
        $outlineRect = Get-FitRectangle -CanvasSize 32 -ImageWidth $sourceImage.Width -ImageHeight $sourceImage.Height -PaddingRatio 0.04
        $outlineCanvas.Graphics.DrawImage($sourceImage, $outlineRect)
        $backgroundColor = Get-BackgroundColor -Bitmap $outlineCanvas.Bitmap

        for ($x = 0; $x -lt $outlineCanvas.Bitmap.Width; $x++) {
            for ($y = 0; $y -lt $outlineCanvas.Bitmap.Height; $y++) {
                $pixel = $outlineCanvas.Bitmap.GetPixel($x, $y)
                if (Test-IsBackgroundPixel -Pixel $pixel -BackgroundColor $backgroundColor) {
                    $outlineCanvas.Bitmap.SetPixel($x, $y, [System.Drawing.Color]::Transparent)
                }
                else {
                    $outlineCanvas.Bitmap.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($pixel.A, 255, 255, 255))
                }
            }
        }

        $outlineCanvas.Bitmap.Save((Join-Path $OutputDirectory "outline.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $outlineCanvas.Graphics.Dispose()
        $outlineCanvas.Bitmap.Dispose()
    }
}
finally {
    $sourceImage.Dispose()
}

