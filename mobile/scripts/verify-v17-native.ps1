param([string]$DeviceId='emulator-5554')
$ErrorActionPreference='Stop'
if(!$DeviceId.StartsWith('emulator-')){throw 'Emulator QA only'}
$adb="$env:LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
function Device([string[]]$arguments){$output=& $adb -s $DeviceId @arguments;if($LASTEXITCODE-ne 0){throw "Device command failed: $arguments"};$output}
function UI{Device @('shell','uiautomator','dump','/sdcard/v17.xml')|Out-Null;[xml](Device @('shell','cat','/sdcard/v17.xml'))}
function Tap([string]$label){
  $node=(UI).SelectSingleNode("//node[@content-desc='$label']")
  if(!$node){throw "Missing control: $label"}
  $b=@([regex]::Matches($node.bounds,'\d+')|ForEach-Object{[int]$_.Value})
  if($b[3]-le $b[1] -or $b[2]-le $b[0]){throw "Clipped control: $label"}
  Device @('shell','input','tap',([int](($b[0]+$b[2])/2)).ToString(),([int](($b[1]+$b[3])/2)).ToString())|Out-Null
}
Tap '设置'
if(!(UI).SelectSingleNode("//node[@text='qa-owner@example.test']")){throw 'Use isolated QA account'}
Tap '关闭设置'
$privacy=(UI).SelectSingleNode("//node[starts-with(@content-desc,'可见范围：')]")
Tap $privacy.'content-desc'
Tap '记录可见范围：好友可见'
if(!(UI).SelectSingleNode("//node[@content-desc='可见范围：好友可见']")){throw 'Privacy selection not applied'}
foreach($i in 1..5){
  $ui=UI
  $node=$ui.SelectSingleNode("//node[@content-desc='记录操作：测试牛奶']")
  $b=@([regex]::Matches($node.bounds,'\d+')|ForEach-Object{[int]$_.Value})
  if($b[3]-gt $b[1]){break}
  $scroll=$ui.SelectSingleNode("//node[@scrollable='true' and @class='android.widget.ScrollView']")
  if(!$scroll){throw 'Record list not scrollable'}
  $s=@([regex]::Matches($scroll.bounds,'\d+')|ForEach-Object{[int]$_.Value})
  $x=([int](($s[0]+$s[2])/2)).ToString()
  Device @('shell','input','swipe',$x,($s[3]-15).ToString(),$x,($s[1]+15).ToString(),'350')|Out-Null
}
Tap '记录操作：测试牛奶'
if((UI).SelectSingleNode("//node[@content-desc='收藏为常用餐食']")){Tap '收藏为常用餐食'}else{Tap '关闭记录操作'}
Tap '常用餐食：测试牛奶'
Tap '0.5份'
Tap '记入常用餐食'
foreach($i in 1..5){if(!(UI).SelectSingleNode("//node[@content-desc='记入常用餐食']")){break}}
Tap '记录类型：饮食'
Tap '记录内容'
$marker='v17-native-undo-'+[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
Device @('shell','input','text',$marker)|Out-Null
Tap '发送记录'
$ready=$false
foreach($i in 1..10){if((UI).SelectSingleNode("//node[@content-desc='撤销刚保存的记录']")){$ready=$true;break}}
if(!$ready){throw 'Saved notice missing'}
Tap '撤销刚保存的记录'
foreach($i in 1..5){$ui=UI;if(!$ui.SelectSingleNode("//node[contains(@text,'$marker')]")){break}}
if($ui.SelectSingleNode("//node[contains(@text,'$marker')]")){throw 'Undone record still visible'}
Device @('shell','screencap','-p','/sdcard/v17-native-controls.png')|Out-Null
Device @('pull','/sdcard/v17-native-controls.png',(Join-Path $root 'output/playwright/v17-native-controls.png'))|Out-Null
Write-Output 'PASS: native privacy sheet, favorite half portion, automatic-save notice and undo'
