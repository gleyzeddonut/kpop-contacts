const { execFileSync } = require('child_process')

// Strip extended attributes (iCloud FinderInfo / fileprovider tags) from the
// packaged app before signing. codesign refuses to sign anything carrying
// them: "resource fork, Finder information, or similar detritus not allowed".
exports.default = async function afterPack(context) {
  if (process.platform !== 'darwin') return
  execFileSync('xattr', ['-cr', context.appOutDir])
}
