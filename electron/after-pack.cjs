// electron-builder never copies a folder named node_modules into extraResources, and the server
// needs its own. This puts it next to the rest of the server, outside the asar.
const { cpSync } = require("node:fs");
const path = require("node:path");

module.exports = async (context) => {
  const resources = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources");
  cpSync(path.join(__dirname, "..", "dist-app", "server", "node_modules"), path.join(resources, "server", "node_modules"), {
    recursive: true,
    verbatimSymlinks: true,
  });
};
