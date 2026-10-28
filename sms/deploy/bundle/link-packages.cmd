@echo off
rem Run once after unzipping, from this folder. Links node_modules\@sms\* to the
rem compiled packages beside it (directory junctions, no admin rights needed).
cd /d "%~dp0"
if not exist node_modules\@sms mkdir node_modules\@sms
for %%P in (shared sync-worker cli api) do (
  if exist "node_modules\@sms\%%P" rmdir /s /q "node_modules\@sms\%%P"
  mklink /J "node_modules\@sms\%%P" "%~dp0%%P" >nul
)
echo Packages linked.
