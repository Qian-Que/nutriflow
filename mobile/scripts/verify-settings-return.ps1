param([string]$DeviceId='emulator-5554')
$ErrorActionPreference='Stop'
if (!$DeviceId.StartsWith('emulator-')) { throw 'Run this UI fixture on an emulator only.' }
$adb="$env:LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
function Device([string[]]$arguments) {
  $output=& $adb -s $DeviceId @arguments
  if ($LASTEXITCODE -ne 0) { throw "Device command failed: $arguments" }
  $output
}
function UI {
  Device @('shell','uiautomator','dump','/sdcard/settings-return.xml') | Out-Null
  [xml](Device @('shell','cat','/sdcard/settings-return.xml'))
}
function Bounds($node) { @([regex]::Matches($node.bounds,'\d+') | ForEach-Object {[int]$_.Value}) }
function Tap([string]$label) {
  $node=(UI).SelectSingleNode("//node[@content-desc='$label']")
  if (!$node) { throw "Missing control: $label" }
  $b=Bounds $node
  if($b[3] -le $b[1]) { throw "Clipped control: $label" }
  Device @('shell','input','tap',([int](($b[0]+$b[2])/2)).ToString(),([int](($b[1]+$b[3])/2)).ToString()) | Out-Null
}
function Assert-Footer([string]$stage) {
  $ui=UI
  $tab=$ui.SelectSingleNode("//node[contains(@content-desc, ', 记录')]")
  if (!$tab) { throw "$stage : Bottom navigation did not recover" }
  $tabBounds=Bounds $tab
  foreach($label in @('visibility')) {
    $node=$ui.SelectSingleNode("//node[starts-with(@content-desc,'可见范围：')]")
    if(!$node) { throw "$stage : Missing visibility selector" }
    $b=Bounds $node
    if($b[3]-$b[1] -lt 40 -or $b[3] -gt $tabBounds[1]) { throw "$stage : Visibility control overlaps bottom navigation: $label $($node.bounds)" }
  }
  Write-Output "PASS: $stage visibility options fully above bottom navigation"
}
function Shot([string]$name) {
  Device @('shell','screencap','-p',"/sdcard/$name.png") | Out-Null
  Device @('pull',"/sdcard/$name.png",(Join-Path $root "output/playwright/$name.png")) | Out-Null
}
$originalFont=(Device @('shell','settings','get','system','font_scale')).Trim()
try {
  Tap '设置'
  if (!(UI).SelectSingleNode("//node[@text='qa-owner@example.test']")) { throw 'Use the isolated QA account for this fixture.' }
  Tap '关闭设置'
  Assert-Footer 'settings without keyboard'
  foreach($cycle in 1..3) {
    Tap '设置'
    if($cycle -eq 2) { Tap '切换日夜主题' }
    Tap '接口地址'
    Tap '关闭设置'
    Assert-Footer "settings keyboard return $cycle"
  }
  Tap '记录内容'
  $ui=UI
  $send=$ui.SelectSingleNode("//node[@content-desc='发送记录']")
  $size=Device @('shell','wm','size') | Out-String
  $height=[int]([regex]::Match($size,'\d+x(\d+)').Groups[1].Value)
  if(!$send -or (Bounds $send)[3] -gt $height*0.7) { throw 'Composer is obscured by the keyboard' }
  Shot 'r25-composer-keyboard'
  Device @('shell','input','keyevent','4') | Out-Null
  Assert-Footer 'composer keyboard dismissed'
  Device @('shell','settings','put','system','font_scale','1.3') | Out-Null
  Device @('shell','am','force-stop','com.qianque1.nutritionassistantcn') | Out-Null
  Device @('shell','am','start','-W','-n','com.qianque1.nutritionassistantcn/.MainActivity') | Out-Null
  $ui=UI
  Tap '设置'
  Tap '关闭设置'
  Assert-Footer 'large font settings return'
  Shot 'r25-large-font-return'
} finally {
  if($originalFont -eq 'null') { Device @('shell','settings','delete','system','font_scale') | Out-Null }
  else { Device @('shell','settings','put','system','font_scale',$originalFont) | Out-Null }
  Device @('shell','am','force-stop','com.qianque1.nutritionassistantcn') | Out-Null
  Device @('shell','am','start','-W','-n','com.qianque1.nutritionassistantcn/.MainActivity') | Out-Null
}
Assert-Footer 'restored font'
Shot 'r25-settings-return-fixed'
