const { spawn } = require('node:child_process');
const path = require('node:path');

const saveScript = String.raw`
$ErrorActionPreference = 'Stop'
$inputPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine()))
$target = [IO.Path]::GetFullPath($inputPath)
$contents = [Console]::In.ReadToEnd()
$root = [IO.Path]::GetPathRoot($target).TrimEnd('\')
$parent = [IO.Path]::GetDirectoryName($target)
$stage = [IO.Path]::Combine($parent, '.brake-save-' + [Guid]::NewGuid().ToString('N'))
$temporary = [IO.Path]::Combine($stage, 'project.tmp')
$reparse = [IO.FileAttributes]::ReparsePoint

function Assert-RealDirectory([string]$directory) {
  while ($directory) {
    # Windows exposes attributes for entries on a share rather than its UNC root.
    if ($root.StartsWith('\\') -and $directory.TrimEnd('\') -ieq $root) { return }
    $attributes = [IO.File]::GetAttributes($directory)
    if (($attributes -band $reparse) -or -not ($attributes -band [IO.FileAttributes]::Directory)) {
      throw 'Invalid save directory'
    }
    $directory = [IO.Path]::GetDirectoryName($directory)
  }
}

$ownsStage = $false
$ownsTemporary = $false
$published = $false
try {
  Assert-RealDirectory $parent
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $directoryAcl = [Security.AccessControl.DirectorySecurity]::new()
  $directoryAcl.SetAccessRuleProtection($true, $false)
  $directoryAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
    $user, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow'))
  if ([IO.Directory]::Exists($stage) -or [IO.File]::Exists($stage)) { throw 'Save staging name already exists' }
  [IO.Directory]::CreateDirectory($stage, $directoryAcl) | Out-Null
  Assert-RealDirectory $stage
  if ([IO.Directory]::GetAccessControl($stage).GetSecurityDescriptorSddlForm('Access') -cne
      $directoryAcl.GetSecurityDescriptorSddlForm('Access')) { throw 'Invalid save staging permissions' }
  $ownsStage = $true

  # Apply the private DACL during exclusive file creation, before writing data.
  $fileAcl = [Security.AccessControl.FileSecurity]::new()
  $fileAcl.SetAccessRuleProtection($true, $false)
  $fileAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($user, 'FullControl', 'Allow'))
  $stream = [IO.FileStream]::new($temporary, 'CreateNew', 'FullControl', 'None', 4096, 'None', $fileAcl)
  $ownsTemporary = $true
  try {
    $bytes = [Convert]::FromBase64String($contents)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
  } finally { $stream.Dispose() }

  $delays = @(25, 50, 100, 200, 400)
  for ($attempt = 0; ; $attempt++) {
    Assert-RealDirectory $stage
    $attributes = $null
    try { $attributes = [IO.File]::GetAttributes($target) } catch [IO.FileNotFoundException] {}
    if ($null -ne $attributes -and ($attributes -band ($reparse -bor [IO.FileAttributes]::Directory))) {
      throw 'Invalid save destination'
    }
    try {
      if ($null -eq $attributes) { [IO.File]::Move($temporary, $target) }
      else {
        # File.Replace invokes ReplaceFileW. Treat DACL/metadata merge errors as save failures.
        [IO.File]::Replace($temporary, $target, [NullString]::Value, $false)
      }
      $ownsTemporary = $false
      $published = $true
      break
    } catch {
      $code = $_.Exception.GetBaseException().HResult -band 65535
      if ($attempt -ge $delays.Length -or $code -notin @(5, 32, 33)) { throw }
      Start-Sleep -Milliseconds $delays[$attempt]
    }
  }
} finally {
  if ($ownsStage) {
    try {
      Assert-RealDirectory $stage
      if ($ownsTemporary) { [IO.File]::Delete($temporary) }
      [IO.Directory]::Delete($stage)
    } catch {
      if (-not $published) { throw }
    }
  }
}
`;
const encodedSaveScript = Buffer.from(saveScript, 'utf16le').toString('base64');

function windowsPowerShell() {
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !/^[a-z]:[\\/]/i.test(systemRoot)) throw new Error('Windows SystemRoot is unavailable');
  return path.resolve(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function windowsPowerShellEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'PSMODULEPATH'));
  return { ...env, ...extra, PSModulePath: path.join(path.dirname(windowsPowerShell()), 'Modules') };
}

async function windowsWriteProject(target, contents) {
  // A fixed command receives the path and bytes only as data. Keep the wire
  // representation ASCII so the console encoding cannot corrupt Unicode.
  const payload = Buffer.from(target, 'utf8').toString('base64') + '\n' + Buffer.from(contents, 'utf8').toString('base64');
  try {
    const executable = windowsPowerShell();
    await new Promise((resolve, reject) => {
      const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedSaveScript], {
        cwd: path.dirname(executable), windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'], env: windowsPowerShellEnv(),
      });
      child.on('error', reject);
      child.stdin.on('error', reject);
      child.on('close', code => code === 0 ? resolve() : reject(new Error('Windows save failed')));
      child.stdin.end(payload);
    });
  } catch {
    throw new Error('실험 파일을 저장할 수 없습니다. 폴더와 파일의 권한을 확인해 주세요.');
  }
}

module.exports = { windowsPowerShell, windowsPowerShellEnv, windowsWriteProject };
