param([string]$DbName='master',[string]$Query)
$cs = "Server=localhost,14330;Database=$DbName;Integrated Security=True;TrustServerCertificate=True;Connect Timeout=15"
$conn = New-Object System.Data.SqlClient.SqlConnection $cs
$conn.Open()
$conn.FireInfoMessageEventOnUserErrors = $false
$handler = [System.Data.SqlClient.SqlInfoMessageEventHandler]{ param($s,$e) Write-Output $e.Message }
$conn.add_InfoMessage($handler)
$cmd = $conn.CreateCommand(); $cmd.CommandText = $Query; $cmd.CommandTimeout = 600
$n = $cmd.ExecuteNonQuery()
Write-Output "rows affected: $n"
$conn.Close()
