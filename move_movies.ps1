# Temporary PowerShell Executable Script
$dest = "C:\Users\Ahmed\Downloads\aaaaaaaq"
if (!(Test-Path -Path $dest)) {
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
}

$files = @(
    "M05 - (2002) - Spider-Man.mp4",
    "M06 - (2003) - Daredevil.mp4",
    "M07 - (2003) - X2 - X-Men United.mp4",
    "M14 - (2007) - Ghost Rider.mp4",
    "M33 - (2014) - X-Men - Days of Future Past.mp4",
    "M46 - (2018) - Black Panther.mp4",
    "M68 - (2023) - Spider-Man - Across the Spider-Verse.mp4",
    "M70 - (2024) - Deadpool and Wolverine.mp4",
    "M76 - (2025) - The Fantastic Four - First Steps.mkv"
)

foreach ($f in $files) {
    # Smart search in Downloads directory tree for filename
    $found = Get-ChildItem -Path "C:\Users\Ahmed\Downloads" -Filter $f -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) {
        Move-Item -Path $found.FullName -Destination $dest -Force
        Write-Host "MOVED: $($found.FullName) -> $dest" -ForegroundColor Green
    } else {
        Write-Host "NOT FOUND: $f" -ForegroundColor Yellow
    }
}

Write-Host "Done!" -ForegroundColor Cyan
