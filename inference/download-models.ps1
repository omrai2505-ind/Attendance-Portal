$ErrorActionPreference = 'Stop'

$repositoryUrl = 'https://github.com/opencv/opencv_zoo.git'
$repositoryCommit = '47534e27c9851bb1128ccc0102f1145e27f23f98'
$checkoutPath = Join-Path $PSScriptRoot '.opencv-zoo'
$modelPath = Join-Path $PSScriptRoot 'models'
$yunetName = 'face_detection_yunet_2023mar.onnx'
$sfaceName = 'face_recognition_sface_2021dec.onnx'

git lfs version | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'Git LFS is required to download the model files.'
}

if (-not (Test-Path (Join-Path $checkoutPath '.git'))) {
  git clone --filter=blob:none --no-checkout $repositoryUrl $checkoutPath
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not clone the pinned OpenCV Zoo model source.'
  }
}

git -C $checkoutPath fetch origin $repositoryCommit
if ($LASTEXITCODE -ne 0) {
  throw 'Could not fetch the pinned OpenCV Zoo revision.'
}
git -C $checkoutPath checkout --detach $repositoryCommit
if ($LASTEXITCODE -ne 0) {
  throw 'Could not check out the pinned OpenCV Zoo revision.'
}
git -C $checkoutPath lfs pull --include="models/face_detection_yunet/$yunetName,models/face_recognition_sface/$sfaceName"
if ($LASTEXITCODE -ne 0) {
  throw 'Could not download the pinned model weights with Git LFS.'
}

New-Item -ItemType Directory -Force -Path $modelPath | Out-Null
Copy-Item -Force (Join-Path $checkoutPath "models\face_detection_yunet\$yunetName") $modelPath
Copy-Item -Force (Join-Path $checkoutPath "models\face_recognition_sface\$sfaceName") $modelPath

foreach ($name in @($yunetName, $sfaceName)) {
  $file = Get-Item (Join-Path $modelPath $name)
  if ($file.Length -lt 100000) {
    throw "The downloaded model file '$name' is incomplete or still a Git LFS pointer."
  }
  Write-Output "$($file.Name): $($file.Length) bytes"
}
