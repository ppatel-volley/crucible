<#!
  Poll .agent-comms/outbox for messages that need a review from Cursor (or any external agent).

  Convention (see skills/comms/SKILL.md):
  - from: claude-code
  - to: cursor-agent   (or cursor-*)
  - status: pending
  - type: request | review   (recommended)

  Exit codes: 0 = nothing pending, 1 = one or more items need attention
#>
param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$outbox = Join-Path $RepoRoot '.agent-comms' 'outbox'
if (-not (Test-Path $outbox)) {
    Write-Host "No outbox at $outbox"
    exit 0
}

function Get-FrontmatterField {
    param([string]$Content, [string]$Field)
    if ($Content -match "(?m)^${Field}:\s*(.+)\s*$") { return $matches[1].Trim() }
    return $null
}

$pending = [System.Collections.ArrayList]@()
Get-ChildItem $outbox -Filter '*.md' -File | ForEach-Object {
    $raw = Get-Content $_.FullName -Raw
    if ($raw -notmatch '(?s)^---\r?\n(.+?)\r?\n---') { return }
    $fm = $matches[1]
    $status = Get-FrontmatterField $fm 'status'
    $to = (Get-FrontmatterField $fm 'to') -replace '^["'']|["'']$'
    $from = Get-FrontmatterField $fm 'from'
    $type = Get-FrontmatterField $fm 'type'
    $topic = Get-FrontmatterField $fm 'topic'
    $pri = Get-FrontmatterField $fm 'priority'

    if ($status -ne 'pending') { return }
    if ($from -ne 'claude-code') { return }
    $toCursor = ($to -eq 'cursor-agent') -or ($to -match '^cursor-\*$') -or ($to -eq '*')
    if (-not $toCursor) { return }
    $wantsReview = $type -match 'request|review'
    if (-not $wantsReview) { return }

    [void]$pending.Add([PSCustomObject]@{
        File     = $_.Name
        Topic    = $topic
        Type     = $type
        Priority = $pri
        Path     = $_.FullName
    })
}

if ($pending.Count -eq 0) {
    Write-Host "No pending Claude Code -> Cursor review requests in outbox."
    exit 0
}

Write-Host "Cursor review needed ($($pending.Count) file(s)):" -ForegroundColor Yellow
$pending | Format-Table -AutoSize File, Topic, Type, Priority
Write-Host "Read each file, then reply in .agent-comms/inbox/ with type response|review and references-message set."
exit 1

