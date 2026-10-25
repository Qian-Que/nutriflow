param([string]$DeviceId='emulator-5554')
$ErrorActionPreference='Stop'
if (!$DeviceId.StartsWith('emulator-')) { throw 'Run this fixture on an emulator only.' }
$adb="$env:LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
function Device([string[]]$arguments) {
  $output=& $adb -s $DeviceId @arguments
  if ($LASTEXITCODE -ne 0) { throw "Device command failed: $arguments" }
  $output
}
function UI {
  Device @('shell','uiautomator','dump','/sdcard/autosave.xml') | Out-Null
  [xml](Device @('shell','cat','/sdcard/autosave.xml'))
}
function Tap([string]$label) {
  $node=(UI).SelectSingleNode("//node[@content-desc='$label']")
  if (!$node) { throw "Missing control: $label" }
  $b=@([regex]::Matches($node.bounds,'\d+') | ForEach-Object {[int]$_.Value})
  Device @('shell','input','tap',([int](($b[0]+$b[2])/2)).ToString(),([int](($b[1]+$b[3])/2)).ToString()) | Out-Null
}
Tap '设置'
if (!(UI).SelectSingleNode("//node[@text='qa-owner@example.test']")) { throw 'Use the isolated QA account.' }
Tap '关闭设置'
Tap '记录类型：饮食'
Tap '记录内容'
$marker='autosave-native-'+[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
Device @('shell','input','text',$marker) | Out-Null
Tap '发送记录'
$uploaded=$false
foreach($attempt in 1..10) {
  $node=(UI).SelectSingleNode("//node[@content-desc='记录内容']")
  if($node.text -notlike "*$marker*") { $uploaded=$true;break }
}
if(!$uploaded) {throw 'Upload not acknowledged'}
Device @('shell','am','force-stop','com.qianque1.nutritionassistantcn') | Out-Null
Start-Sleep -Seconds 12
Device @('shell','am','start','-W','-n','com.qianque1.nutritionassistantcn/.MainActivity') | Out-Null
$found=$false
foreach($attempt in 1..10) {
  if((UI).SelectSingleNode("//node[contains(@text,'$marker') and contains(@text,'AI 估算') or contains(@content-desc,'$marker') and contains(@content-desc,'已保存')]")) {$found=$true;break}
}
if(!$found) {throw 'Automatically saved record missing after reopening'}
Device @('shell','screencap','-p','/sdcard/r26-native-autosave.png') | Out-Null
Device @('pull','/sdcard/r26-native-autosave.png',(Join-Path $root 'output/playwright/r26-native-autosave.png')) | Out-Null
Write-Output 'PASS: upload acknowledged, app force-stopped, background result automatically saved and visible after cold launch'
