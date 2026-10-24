param(
  [string]$WorkbookPath = 'C:\Users\User\Downloads\TH Verifier workbook.xlsx',
  [string]$OutputPath = (Join-Path $PSScriptRoot 'data\verifier-queue-workbook.json'),
  [string]$ReportPath = (Join-Path $PSScriptRoot 'data\verifier-queue-workbook-report.json')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Read-WorkbookXml {
  param(
    [Parameter(Mandatory = $true)]
    [System.IO.Compression.ZipArchive]$Archive,
    [Parameter(Mandatory = $true)]
    [string]$EntryName
  )

  $entry = $Archive.GetEntry($EntryName)
  if ($null -eq $entry) {
    throw "Workbook is missing required XML entry '$EntryName'."
  }
  $reader = [System.IO.StreamReader]::new($entry.Open())
  try {
    [xml]$document = $reader.ReadToEnd()
    return $document
  } finally {
    $reader.Dispose()
  }
}

function Get-WorkbookCellValue {
  param(
    [Parameter(Mandatory = $true)]
    [System.Xml.XmlElement]$Cell,
    [Parameter(Mandatory = $true)]
    [string[]]$SharedStrings,
    [Parameter(Mandatory = $true)]
    [System.Xml.XmlNamespaceManager]$NamespaceManager
  )

  $cellType = $Cell.GetAttribute('t')
  if ($cellType -eq 'inlineStr') {
    $inlineString = $Cell.SelectSingleNode('m:is', $NamespaceManager)
    if ($null -eq $inlineString) {
      return ''
    }
    return [string]$inlineString.InnerText
  }

  $valueNode = $Cell.SelectSingleNode('m:v', $NamespaceManager)
  if ($null -eq $valueNode -or [string]::IsNullOrEmpty($valueNode.InnerText)) {
    return ''
  }
  if ($cellType -eq 's') {
    $sharedStringIndex = 0
    if ((-not [int]::TryParse($valueNode.InnerText, [ref]$sharedStringIndex)) -or
      ($sharedStringIndex -lt 0) -or
      ($sharedStringIndex -ge $SharedStrings.Count)) {
      throw "Cell '$($Cell.GetAttribute('r'))' has an invalid shared-string index."
    }
    return $SharedStrings[$sharedStringIndex]
  }
  if ($cellType -eq 'b') {
    if ($valueNode.InnerText -eq '1') { return 'TRUE' }
    if ($valueNode.InnerText -eq '0') { return 'FALSE' }
    throw "Cell '$($Cell.GetAttribute('r'))' has an invalid boolean value."
  }
  return [string]$valueNode.InnerText
}

function Get-CategorySplit {
  param([Parameter(Mandatory = $true)][string]$OriginalRunText)

  $text = $OriginalRunText.Trim()
  $categoryNames = @(
    'All Main Game Bosses',
    'All Vanilla Bosses',
    'All Great Runes',
    'All Remembrances',
    'Immortal Severance',
    'Single Expedition',
    'New Game Pro',
    'Best Ending',
    'True Ending',
    'Purification Ending',
    'All Bosses',
    'All Memories',
    'All Skills',
    'Pantheon 5',
    'Mortal Journey',
    'Shura Ending',
    'Purification',
    'Shura',
    'Return Ending',
    'Return',
    'Any%',
    'Any %',
    'P5'
  )
  $knownRestrictionStart = '^(?i)(?:SL\s*\d+\b|BL\s*\d+\b|RL\s*\d+\b|AP\s*\d+\b|'
    + 'no(?:[- ](?:hit|damage|roll(?:ing)?|death|upgrade|summons?|charms?|items?|'
    + 'resurrection|healing|bonfires?))\b|damageless\b|hitless\b|'
    + '(?:magic|sorcery|miracles|incantations|melee|bow|weapon)\s+only\b)'

  foreach ($knownCategory in $categoryNames) {
    $escapedCategory = [regex]::Escape($knownCategory)
    $match = [regex]::Match($text, ('^(?i)' + $escapedCategory + '(?:\s+(.+))?$'))
    if (-not $match.Success) {
      continue
    }

    if (-not $match.Groups[1].Success) {
      return [pscustomobject]@{
        category = $text
        restrictions = ''
        reliable = $true
      }
    }

    $suffix = $match.Groups[1].Value.Trim()
    if ($suffix -match $knownRestrictionStart) {
      return [pscustomobject]@{
        category = $text.Substring(0, $match.Groups[1].Index).Trim()
        restrictions = $suffix
        reliable = $true
      }
    }
  }

  return [pscustomobject]@{
    category = $text
    restrictions = ''
    reliable = $false
  }
}

function Get-VerificationStatus {
  param(
    [string]$Verifier,
    [string]$DateClaimed,
    [string]$Verdict,
    [string]$DateVerified
  )

  switch ($Verdict.Trim().ToLowerInvariant()) {
    'accepted' { return 'Accepted' }
    'rejected' { return 'Rejected' }
    '' {
      $normalizedVerifier = $Verifier.Trim().ToLowerInvariant()
      if ($normalizedVerifier -and $normalizedVerifier -notin @('n/a', 'na', 'none')) {
        return 'Claimed'
      }
      if (-not $DateClaimed.Trim() -and -not $DateVerified.Trim()) {
        return 'Unclaimed'
      }
      return 'Needs Review'
    }
    default { return 'Needs Review' }
  }
}

function Get-VideoUrlProblem {
  param([string]$Url)

  if ([string]::IsNullOrWhiteSpace($Url)) {
    return 'Missing video URL'
  }
  $parsedUrl = $null
  if (-not [System.Uri]::TryCreate($Url, [System.UriKind]::Absolute, [ref]$parsedUrl)) {
    return 'Not an absolute URL'
  }
  if ($parsedUrl.Scheme -notin @('http', 'https')) {
    return 'URL scheme is not HTTP or HTTPS'
  }
  if ([string]::IsNullOrWhiteSpace($parsedUrl.Host)) {
    return 'URL has no host'
  }
  if ($parsedUrl.UserInfo) {
    return 'URL contains credentials'
  }
  return ''
}

function ConvertFrom-THVerifierWorkbook {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [int]$ExpectedFirstRuns = 3009,
    [int]$ExpectedPostFirstRuns = 13225
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Workbook does not exist: $Path"
  }
  $archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Path).Path)
  try {
    $workbook = Read-WorkbookXml -Archive $archive -EntryName 'xl/workbook.xml'
    $relationships = Read-WorkbookXml -Archive $archive -EntryName 'xl/_rels/workbook.xml.rels'
    $relationshipTargets = @{}
    foreach ($relationship in $relationships.Relationships.Relationship) {
      $relationshipTargets[[string]$relationship.Id] = [string]$relationship.Target
    }

    $relationshipNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    $sheetTargets = @{}
    foreach ($sheet in $workbook.workbook.sheets.sheet) {
      $sheetTargets[[string]$sheet.name] = $relationshipTargets[
        $sheet.GetAttribute('id', $relationshipNamespace)
      ]
    }
    $sharedStrings = [System.Collections.Generic.List[string]]::new()
    $sharedStringsEntry = $archive.GetEntry('xl/sharedStrings.xml')
    if ($null -ne $sharedStringsEntry) {
      $sharedStringsDocument = Read-WorkbookXml -Archive $archive -EntryName 'xl/sharedStrings.xml'
      foreach ($sharedString in $sharedStringsDocument.sst.si) {
        $sharedStrings.Add([string]$sharedString.InnerText)
      }
    }
    $sharedStringArray = $sharedStrings.ToArray()

    $runs = [System.Collections.Generic.List[object]]::new()
    $formulaOnlySubmissionCount = 0
    $missingCoreFieldRows = [System.Collections.Generic.List[object]]::new()
    foreach ($sourceSheet in @('first_runs', 'post_first_runs')) {
      $target = $sheetTargets[$sourceSheet]
      if ([string]::IsNullOrWhiteSpace($target)) {
        throw "Workbook is missing required worksheet '$sourceSheet'."
      }
      $entryName = if ($target.StartsWith('/')) {
        $target.TrimStart('/')
      } else {
        'xl/' + $target
      }
      $sheetDocument = Read-WorkbookXml -Archive $archive -EntryName $entryName
      $namespaceManager = [System.Xml.XmlNamespaceManager]::new($sheetDocument.NameTable)
      $namespaceManager.AddNamespace(
        'm',
        'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
      )
      foreach ($row in $sheetDocument.SelectNodes('//m:sheetData/m:row', $namespaceManager)) {
        $rowNumber = [int]$row.GetAttribute('r')
        if ($rowNumber -le 1) {
          continue
        }

        $values = @{}
        foreach ($column in @('B', 'E', 'F', 'G', 'K', 'N', 'O', 'P', 'Q')) {
          $values[$column] = ''
        }
        $formulaBackedFields = [System.Collections.Generic.List[string]]::new()
        $hasNonFormulaValue = $false
        $rowHasFormula = $false
        foreach ($cell in $row.SelectNodes('m:c', $namespaceManager)) {
          $cellReference = $cell.GetAttribute('r')
          if ($cellReference -notmatch '^([A-Z]+)') {
            continue
          }
          $column = $Matches[1]
          $formula = $cell.SelectSingleNode('m:f', $namespaceManager)
          $value = Get-WorkbookCellValue -Cell $cell `
            -SharedStrings $sharedStringArray `
            -NamespaceManager $namespaceManager
          if ($null -ne $formula) {
            $rowHasFormula = $true
            if (($column -in @('B', 'E', 'F', 'G', 'K', 'N', 'O', 'P', 'Q')) -and
              (-not [string]::IsNullOrWhiteSpace($value))) {
              $formulaBackedFields.Add($column)
            }
          } elseif (-not [string]::IsNullOrWhiteSpace($value)) {
            $hasNonFormulaValue = $true
          }
          $values[$column] = [string]$value
        }

        $coreColumns = @('B', 'E', 'G', 'K')
        $presentCoreColumns = @(
          $coreColumns | Where-Object {
            $values.ContainsKey($_) -and -not [string]::IsNullOrWhiteSpace($values[$_])
          }
        )
        if ($presentCoreColumns.Count -eq 0) {
          continue
        }
        if ($presentCoreColumns.Count -ne $coreColumns.Count) {
          $missingCoreFieldRows.Add([pscustomobject]@{
            sourceSheet = $sourceSheet
            row = $rowNumber
            presentFields = $presentCoreColumns
          })
          continue
        }

        $originalRunText = $values['G']
        $split = Get-CategorySplit -OriginalRunText $originalRunText
        $verifier = $values['N']
        $dateClaimed = $values['O']
        $verdict = $values['P']
        $dateVerified = $values['Q']
        if ($rowHasFormula -and -not $hasNonFormulaValue) {
          $formulaOnlySubmissionCount++
        }
        $runs.Add([pscustomobject][ordered]@{
          sourceSheet = $sourceSheet
          submissionType = if ($sourceSheet -eq 'first_runs') { 'first' } else { 'post' }
          row = $rowNumber
          runner = $values['B']
          game = $values['E']
          runType = $values['F']
          originalRunText = $originalRunText
          category = $split.category
          restrictions = $split.restrictions
          categorySplitReliable = $split.reliable
          videoUrl = $values['K']
          status = Get-VerificationStatus -Verifier $verifier `
            -DateClaimed $dateClaimed -Verdict $verdict -DateVerified $dateVerified
          verifier = $verifier
          dateClaimed = $dateClaimed
          verdict = $verdict
          dateVerified = $dateVerified
          formulaBackedFields = @($formulaBackedFields.ToArray())
          formulaOnlyRow = [bool]($rowHasFormula -and -not $hasNonFormulaValue)
        })
      }
    }

    $firstCount = @($runs | Where-Object { $_.sourceSheet -eq 'first_runs' }).Count
    $postCount = @($runs | Where-Object { $_.sourceSheet -eq 'post_first_runs' }).Count
    if ($firstCount -ne $ExpectedFirstRuns -or $postCount -ne $ExpectedPostFirstRuns) {
      throw "Workbook submission count mismatch: first_runs=$firstCount (expected $ExpectedFirstRuns), post_first_runs=$postCount (expected $ExpectedPostFirstRuns). No output was written."
    }
    if ($missingCoreFieldRows.Count -gt 0) {
      throw "Found $($missingCoreFieldRows.Count) rows with partial core fields. No output was written."
    }

    $statusCounts = [ordered]@{}
    foreach ($status in @('Unclaimed', 'Claimed', 'Accepted', 'Rejected', 'Needs Review')) {
      $statusCounts[$status] = @($runs | Where-Object { $_.status -eq $status }).Count
    }
    $urlProblems = [System.Collections.Generic.List[object]]::new()
    $unreliableSplits = [System.Collections.Generic.List[object]]::new()
    $needsReview = [System.Collections.Generic.List[object]]::new()
    foreach ($run in $runs) {
      $urlProblem = Get-VideoUrlProblem -Url $run.videoUrl
      if ($urlProblem) {
        $urlProblems.Add([pscustomobject]@{
          sourceSheet = $run.sourceSheet
          row = $run.row
          videoUrl = $run.videoUrl
          reason = $urlProblem
        })
      }
      if (-not $run.categorySplitReliable) {
        $unreliableSplits.Add([pscustomobject]@{
          sourceSheet = $run.sourceSheet
          row = $run.row
          originalRunText = $run.originalRunText
        })
      }
      if ($run.status -eq 'Needs Review') {
        $needsReview.Add([pscustomobject]@{
          sourceSheet = $run.sourceSheet
          row = $run.row
          verifier = $run.verifier
          dateClaimed = $run.dateClaimed
          verdict = $run.verdict
          dateVerified = $run.dateVerified
          originalRunText = $run.originalRunText
        })
      }
    }

    $report = [pscustomobject][ordered]@{
      sourceWorkbook = [System.IO.Path]::GetFullPath($Path)
      totalSubmissions = $runs.Count
      countsBySheet = [pscustomobject][ordered]@{
        first_runs = $firstCount
        post_first_runs = $postCount
      }
      countsByStatus = [pscustomobject]$statusCounts
      cachedFormulaOnlySubmissions = $formulaOnlySubmissionCount
      problematicVideoUrlCount = $urlProblems.Count
      problematicVideoUrls = @($urlProblems.ToArray())
      needsReviewCount = $needsReview.Count
      needsReviewRecords = @($needsReview.ToArray())
      unreliableCategoryRestrictionsSplitCount = $unreliableSplits.Count
      unreliableCategoryRestrictionsSplits = @($unreliableSplits.ToArray())
      partialCoreFieldRows = @($missingCoreFieldRows.ToArray())
      duplicatesRemoved = 0
      googleSheetRowLinksCreated = 0
    }
    return [pscustomobject]@{
      runs = @($runs.ToArray())
      report = $report
    }
  } finally {
    $archive.Dispose()
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  foreach ($output in @($OutputPath, $ReportPath)) {
    if (Test-Path -LiteralPath $output) {
      throw "Refusing to overwrite existing output file: $output"
    }
  }
  $result = ConvertFrom-THVerifierWorkbook -Path $WorkbookPath
  $outputDirectory = Split-Path -Parent $OutputPath
  $reportDirectory = Split-Path -Parent $ReportPath
  foreach ($directory in @($outputDirectory, $reportDirectory) | Select-Object -Unique) {
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
      New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
  }
  $utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
  $runsJson = ConvertTo-Json -InputObject @($result.runs) -Depth 8
  $reportJson = ConvertTo-Json -InputObject $result.report -Depth 8
  [System.IO.File]::WriteAllText(
    [System.IO.Path]::GetFullPath($OutputPath),
    $runsJson + [Environment]::NewLine,
    $utf8WithoutBom
  )
  [System.IO.File]::WriteAllText(
    [System.IO.Path]::GetFullPath($ReportPath),
    $reportJson + [Environment]::NewLine,
    $utf8WithoutBom
  )
  Write-Output "Imported $($result.report.totalSubmissions) submissions to $OutputPath"
  Write-Output "Import report written to $ReportPath"
}
