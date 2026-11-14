// Runs after electron-builder lays out the app, before the DMG is made.
const { cpSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

module.exports = async (context) => {
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  // electron-builder never copies a folder named node_modules into extraResources, and the server
  // needs its own. This puts it next to the rest of the server, outside the asar.
  cpSync(path.join(__dirname, "..", "dist-app", "server", "node_modules"), path.join(app, "Contents", "Resources", "server", "node_modules"), {
    recursive: true,
    verbatimSymlinks: true,
  });
  // There is no Developer ID, so the app is signed ad hoc. Without this it keeps Electron's own signature,
  // which names it "Electron" and no longer matches its files, and macOS ties the microphone permission
  // to the signature.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
};
