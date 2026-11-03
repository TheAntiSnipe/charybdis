param([string]$Out = "$PSScriptRoot\..\scratch\itunes-export.json")
# Read-only export of user playlists via the iTunes COM interface (the .itl file is proprietary).
$ErrorActionPreference = 'Stop'
$itunes = New-Object -ComObject iTunes.Application

$result = @()
foreach ($pl in $itunes.LibrarySource.Playlists) {
    # Kind 2 = user playlist; SpecialKind 0 = none (skips Music, Movies, Podcasts, Purchased...)
    if ($pl.Kind -ne 2 -or $pl.SpecialKind -ne 0) { continue }
    $tracks = @()
    foreach ($t in $pl.Tracks) {
        if ($t.Kind -ne 1) { continue }   # 1 = file track
        $tracks += [pscustomobject]@{
            location  = $t.Location
            name      = $t.Name
            artist    = $t.Artist
            album     = $t.Album
            dateAdded = $t.DateAdded.ToString('o')
        }
    }
    $result += [pscustomobject]@{
        name    = $pl.Name
        smart   = [bool]$pl.Smart
        folder  = $pl.Parent.Name
        tracks  = $tracks
    }
    Write-Host ("{0,-40} smart={1,-5} tracks={2}" -f $pl.Name, $pl.Smart, $tracks.Count)
}

$result | ConvertTo-Json -Depth 6 | Set-Content -Path $Out -Encoding utf8
Write-Host "Wrote $($result.Count) playlists to $Out"
