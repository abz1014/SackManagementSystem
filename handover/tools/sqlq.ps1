# Ad-hoc query runner against the LOCAL SQLEXPRESS copies, Windows auth.
# Usage: powershell -File sqlq.ps1 -Db <database> -Query "<sql>" [-Out <file>]
param(
  [Parameter(Mandatory=$true)][string]$DbName,
  [Parameter(Mandatory=$true)][string]$Query,
  [string]$Out = "",
  [string]$Server = "localhost,14330"
)

$cs = "Server=$Server;Database=$DbName;Integrated Security=True;TrustServerCertificate=True;Encrypt=True;Connect Timeout=30"
$conn = New-Object System.Data.SqlClient.SqlConnection $cs
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = $Query
$cmd.CommandTimeout = 600
$rdr = $cmd.ExecuteReader()

$sb = New-Object System.Text.StringBuilder
do {
  $cols = @()
  for ($i = 0; $i -lt $rdr.FieldCount; $i++) { $cols += $rdr.GetName($i) }
  if ($cols.Count -gt 0) { [void]$sb.AppendLine(($cols -join "`t")) }
  while ($rdr.Read()) {
    $vals = @()
    for ($i = 0; $i -lt $rdr.FieldCount; $i++) {
      $v = $rdr.GetValue($i)
      if ($v -is [System.DBNull]) { $vals += "NULL" } else { $vals += ([string]$v) }
    }
    [void]$sb.AppendLine(($vals -join "`t"))
  }
  [void]$sb.AppendLine("")
} while ($rdr.NextResult())

$rdr.Close()
$conn.Close()

if ($Out -ne "") {
  [System.IO.File]::WriteAllText($Out, $sb.ToString(), (New-Object System.Text.UTF8Encoding $false))
  Write-Output "wrote $($sb.Length) chars to $Out"
} else {
  Write-Output $sb.ToString()
}
