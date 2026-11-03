$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$stack = 'charybdis'

$bucket = aws cloudformation describe-stacks --stack-name $stack --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text
$domain = aws cloudformation describe-stacks --stack-name $stack --query "Stacks[0].Outputs[?OutputKey=='DistributionDomain'].OutputValue" --output text

Push-Location (Join-Path $root 'web')
try {
    npm.cmd ci
    if ($LASTEXITCODE) { throw 'npm ci failed' }
    npm.cmd run build
    if ($LASTEXITCODE) { throw 'build failed' }
} finally { Pop-Location }

$dist = Join-Path $root 'web\dist'
# Only touches the web/ prefix; music/, art/ and index/ are never deleted by this script.
aws s3 sync $dist "s3://$bucket/web" --delete --exclude 'manifest.webmanifest' --only-show-errors
if ($LASTEXITCODE) { throw 'sync failed' }
aws s3 cp (Join-Path $dist 'manifest.webmanifest') "s3://$bucket/web/manifest.webmanifest" --content-type 'application/manifest+json' --only-show-errors
if ($LASTEXITCODE) { throw 'manifest upload failed' }

Write-Host "Deployed: https://$domain"
