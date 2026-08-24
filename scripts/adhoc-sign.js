// electron-builder afterPack hook.
//
// Without an Apple Developer certificate electron-builder skips signing entirely,
// which leaves the repackaged bundle carrying Electron's original linker-signed
// signature. macOS then refuses to launch it with "Poof is damaged and can't be
// opened". An ad-hoc signature (`--sign -`) is enough to make it launchable.
// It is still unsigned as far as Gatekeeper is concerned, so the first launch
// needs right-click -> Open (or removing the quarantine attribute).
const path = require('path');
const { execFileSync } = require('child_process');

exports.default = async function adhocSign(context) {
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  execFileSync('/usr/bin/codesign', [
    '--force',
    '--deep',
    '--sign', '-',
    '--timestamp=none',
    appPath,
  ], { stdio: 'inherit' });

  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], {
    stdio: 'inherit',
  });

  console.log(`  • ad-hoc signed  file=${appPath}`);
};
