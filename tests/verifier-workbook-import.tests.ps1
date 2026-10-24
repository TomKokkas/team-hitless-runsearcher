$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\import-verifier-workbook.ps1')

function Assert-Equal {
  param(
    [Parameter(Mandatory = $true)]$Actual,
    [Parameter(Mandatory = $true)]$Expected,
    [Parameter(Mandatory = $true)][string]$Message
  )
  if ($Actual -ne $Expected) {
    throw "$Message Expected '$Expected', got '$Actual'."
  }
}

$firstCategory = Get-CategorySplit -OriginalRunText 'Any% SL1 No Damage'
Assert-Equal -Actual $firstCategory.category -Expected 'Any%' -Message 'Category parsing failed.'
Assert-Equal -Actual $firstCategory.restrictions -Expected 'SL1 No Damage' -Message 'Restriction parsing failed.'
Assert-Equal -Actual $firstCategory.reliable -Expected $true -Message 'Known category/restriction split was not trusted.'

$ambiguousCategory = Get-CategorySplit -OriginalRunText 'Bloodborne Hitless Any%'
Assert-Equal -Actual $ambiguousCategory.category -Expected 'Bloodborne Hitless Any%' -Message 'Ambiguous text was modified.'
Assert-Equal -Actual $ambiguousCategory.restrictions -Expected '' -Message 'Ambiguous text was split.'
Assert-Equal -Actual $ambiguousCategory.reliable -Expected $false -Message 'Ambiguous split should be reported.'

Assert-Equal -Actual (Get-VerificationStatus -Verifier 'n/a' -DateClaimed '' -Verdict 'Accepted' -DateVerified '') `
  -Expected 'Accepted' -Message 'Accepted status classification failed.'
Assert-Equal -Actual (Get-VerificationStatus -Verifier 'Verifier A' -DateClaimed '' -Verdict '' -DateVerified '') `
  -Expected 'Claimed' -Message 'Claimed status classification failed.'
Assert-Equal -Actual (Get-VerificationStatus -Verifier '' -DateClaimed '2026-01-01' -Verdict '' -DateVerified '') `
  -Expected 'Needs Review' -Message 'Ambiguous claim classification failed.'
Assert-Equal -Actual (Get-VideoUrlProblem -Url 'javascript:alert(1)') `
  -Expected 'URL scheme is not HTTP or HTTPS' -Message 'Unsafe URL was not reported.'

$workbook = Join-Path $env:USERPROFILE 'Downloads\TH Verifier workbook.xlsx'
$result = ConvertFrom-THVerifierWorkbook -Path $workbook
$runs = @($result.runs)
$report = $result.report
Assert-Equal -Actual $runs.Count -Expected 16234 -Message 'Total imported record count is incorrect.'
Assert-Equal -Actual $report.countsBySheet.first_runs -Expected 3009 -Message 'first_runs count is incorrect.'
Assert-Equal -Actual $report.countsBySheet.post_first_runs -Expected 13225 -Message 'post_first_runs count is incorrect.'
Assert-Equal -Actual $report.cachedFormulaOnlySubmissions -Expected 279 -Message 'Cached formula submissions were not all included.'
Assert-Equal -Actual $report.partialCoreFieldRows.Count -Expected 0 -Message 'Unexpected partial source submissions.'
Assert-Equal -Actual $report.duplicatesRemoved -Expected 0 -Message 'Records must not be deduplicated.'
Assert-Equal -Actual $report.googleSheetRowLinksCreated -Expected 0 -Message 'Google Sheet row links must not be invented.'

$firstRuns = @($runs | Where-Object { $_.sourceSheet -eq 'first_runs' })
$postRuns = @($runs | Where-Object { $_.sourceSheet -eq 'post_first_runs' })
Assert-Equal -Actual (@($firstRuns | Where-Object { $_.submissionType -eq 'first' }).Count) `
  -Expected 3009 -Message 'first submissionType mapping is incorrect.'
Assert-Equal -Actual (@($postRuns | Where-Object { $_.submissionType -eq 'post' }).Count) `
  -Expected 13225 -Message 'post submissionType mapping is incorrect.'
Assert-Equal -Actual (@($runs | Where-Object { $_.formulaOnlyRow }).Count) `
  -Expected 279 -Message 'Cached formula-only records were not preserved.'
Assert-Equal -Actual (@($runs | Where-Object { $_.formulaBackedFields.Count -gt 0 }).Count) `
  -Expected 16234 -Message 'Cached formula fields were not detected on every submission.'
Assert-Equal -Actual ((@($runs | ForEach-Object { "$($_.sourceSheet):$($_.row)" } | Select-Object -Unique)).Count) `
  -Expected 16234 -Message 'Source rows were unexpectedly collapsed.'

$requiredProperties = @(
  'sourceSheet', 'submissionType', 'row', 'runner', 'game', 'runType',
  'originalRunText', 'category', 'restrictions', 'videoUrl', 'status',
  'verifier', 'dateClaimed', 'verdict', 'dateVerified', 'formulaBackedFields',
  'formulaOnlyRow'
)
foreach ($run in $runs) {
  foreach ($property in $requiredProperties) {
    if ($null -eq $run.PSObject.Properties[$property]) {
      throw "Imported record $($run.sourceSheet):$($run.row) is missing '$property'."
    }
  }
  if ($run.originalRunText -ne $run.category -and $run.categorySplitReliable -eq $false) {
    throw "Unreliable split changed original category text at $($run.sourceSheet):$($run.row)."
  }
}

$statusSum = 0
foreach ($count in $report.countsByStatus.PSObject.Properties.Value) {
  $statusSum += $count
}
Assert-Equal -Actual $statusSum -Expected 16234 -Message 'Status totals do not reconcile.'

Write-Output "PASS: $($runs.Count) workbook submissions, cached formulas, statuses, URLs and splits verified."
