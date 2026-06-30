param (
    [string]$CommitMessage = "chore: auto-deploy commit"
)

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "        Local Commit & Remote Deploy Script          " -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/3] Staging and Committing Local Changes..." -ForegroundColor Yellow
# Prompt for a commit message if you want to type one, otherwise it defaults
$userInput = Read-Host "Enter commit message (press Enter to use default: '$CommitMessage')"
if (-not [string]::IsNullOrWhiteSpace($userInput)) {
    $CommitMessage = $userInput
}

git add .
git commit -m $CommitMessage

Write-Host ""
Write-Host "[2/3] Pushing to GitHub (origin main)..." -ForegroundColor Yellow
git push origin main

Write-Host ""
Write-Host "[3/3] Accessing Server via SSH to Deploy..." -ForegroundColor Yellow
Write-Host "NOTE: You will be prompted to enter your SSH password for root@86.48.0.69." -ForegroundColor Magenta
Write-Host ""

# These are the commands that will run securely on the server once you enter your password
$remoteCommands = "cd /opt/ingestion-system && git pull origin main && chmod +x ops/*.sh && ./ops/3_build_and_start.sh"

# Launch SSH and pass the deployment commands to run automatically
ssh root@86.48.0.69 $remoteCommands

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "                 Deployment Finished!                " -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
