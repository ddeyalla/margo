// The Mac app. It is a window around the Margo server.
//
// One server at a time. On launch we ask http://127.0.0.1:3210/api/health who is there:
//   - Margo answers: attach to it (for example `npm run dev`) and never start another.
//   - nothing is listening: start the packaged server with Electron's own Node, and stop it on quit.
//   - something else answers: say so and quit.
const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, screen, session, shell } = require("electron");
const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

// MARGO_PORT exists so the start path can be tested while a dev server holds 3210.
const PORT = Number(process.env.MARGO_PORT) || 3210;
const HOST = "127.0.0.1";
const ORIGIN = `http://${HOST}:${PORT}`;
const BROWSER_URL = `http://localhost:${PORT}`;
const START_TIMEOUT_MS = 30_000;
/** How long a server gets to exit after SIGTERM before it is killed. */
const STOP_TIMEOUT_MS = 3000;

// The name sets the menu title. The path is set outright so it is exactly this folder.
// MARGO_USER_DATA, like MARGO_PORT, lets a test copy run beside the real app with its own data.
app.setName("Margo");
const margoUserData = path.join(app.getPath("appData"), "Margo");
/* Before the rename the folder had the old app name. Move it once, so no data is lost. */
const oldUserData = path.join(app.getPath("appData"), "rigg learn");
if (!process.env.MARGO_USER_DATA && !fs.existsSync(margoUserData) && fs.existsSync(oldUserData)) fs.renameSync(oldUserData, margoUserData);
app.setPath("userData", process.env.MARGO_USER_DATA || margoUserData);
const userData = app.getPath("userData");
const dataDir = path.join(userData, "data");
const logPath = path.join(userData, "server.log");
const windowStatePath = path.join(userData, "window.json");

/** The server process, only when this app started it. */
let server = null;
let serverExit = null; // { code, signal } once it has exited
let mainWindow = null;
let quitting = false;
/** True once launch has finished: before that no window opens, since launch makes the one window itself. */
let launched = false;
let stopping = false;

// ---- Server discovery ---------------------------------------------------------------------

/**
 * "ours": Margo answered. "free": nothing is listening. "other": a port taken by something else.
 * "slow": something accepted the connection but did not answer in time, such as a dev server compiling its first route.
 */
const probe = (timeoutMs) =>
  new Promise((resolve) => {
    let timedOut = false;
    const req = http.get({ host: HOST, port: PORT, path: "/api/health", timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk.slice(0, 2000)));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body).app === "margo" ? "ours" : "other");
        } catch {
          resolve("other");
        }
      });
    });
    req.on("timeout", () => {
      timedOut = true;
      req.destroy();
    });
    req.on("error", (error) => resolve(timedOut ? "slow" : error.code === "ECONNREFUSED" ? "free" : "other"));
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- Environment for the server -----------------------------------------------------------

/** The PATH a terminal would have. A Dock launch gets a bare one, and the tutors run the claude and codex CLIs. */
const loginShellPath = () =>
  new Promise((resolve) => {
    const shell = process.env.SHELL || "/bin/zsh";
    execFile(
      shell,
      ["-ilc", `printf '__MARGO_PATH__%s__MARGO_PATH__' "$PATH"`],
      { timeout: 5000 },
      (error, stdout) => {
        // Startup files may print other text, so the PATH sits between markers.
        const found = !error && /__MARGO_PATH__(.+?)__MARGO_PATH__/.exec(stdout);
        resolve(found ? found[1] : null);
      },
    );
  });

const resolvePath = async () => {
  const fromShell = await loginShellPath();
  if (fromShell) return fromShell;
  const home = os.homedir();
  const extras = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".local/bin"),
    path.join(home, ".npm-global/bin"),
    path.join(home, ".bun/bin"),
  ];
  return [...new Set([...(process.env.PATH || "").split(":").filter(Boolean), ...extras])].join(":");
};

/** `<userData>/.env`: KEY=VALUE lines, `#` comments, optional `export` and quotes. */
const readEnvFile = () => {
  let text;
  try {
    text = fs.readFileSync(path.join(userData, ".env"), "utf8");
  } catch {
    return {};
  }
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2];
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length > 1 && value.endsWith(quote)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    values[match[1]] = value;
  }
  return values;
};

// ---- Starting the packaged server ---------------------------------------------------------

/** A folder with server.js and the files it serves. Packaged: in Resources. Source checkout: a local build. */
const findServerDir = () => {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, "server")]
    : [path.join(__dirname, "..", "dist-app", "server"), path.join(__dirname, "..", ".next", "standalone")];
  // The server needs the static files next to it, so a bare `next build` output does not count.
  return candidates.find((dir) => fs.existsSync(path.join(dir, "server.js")) && fs.existsSync(path.join(dir, ".next", "static")));
};

const lastLogLines = (count) => {
  try {
    return fs.readFileSync(logPath, "utf8").trimEnd().split("\n").slice(-count).join("\n");
  } catch {
    return "(no log)";
  }
};

const startServer = (serverDir, shellPath) => {
  fs.mkdirSync(dataDir, { recursive: true });
  const env = {
    ...process.env,
    ...readEnvFile(),
    PATH: shellPath,
    ELECTRON_RUN_AS_NODE: "1",
    PORT: String(PORT),
    HOSTNAME: HOST,
    DATA_DIR: dataDir,
    NODE_ENV: "production",
  };
  const log = fs.openSync(logPath, "w");
  server = spawn(process.execPath, [path.join(serverDir, "server.js")], {
    cwd: serverDir,
    env,
    stdio: ["ignore", log, log],
  });
  fs.closeSync(log); // the child has its own copy
  server.on("exit", (code, signal) => {
    serverExit = { code, signal };
    if (launched && !quitting) void offerRestart(serverExit);
  });
  server.on("error", (error) => {
    fs.appendFileSync(logPath, `\nCould not start the server: ${error.message}\n`);
    serverExit = { code: null, signal: null };
  });
};

/** Asks the server to stop and resolves once it has, killing it if it has not after a few seconds. */
const stopServer = () =>
  new Promise((resolve) => {
    if (!server || serverExit) return resolve();
    const child = server;
    const timer = setTimeout(() => child.kill("SIGKILL"), STOP_TIMEOUT_MS);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });

/** The server this app started died after launch. Say so, and offer a fresh start. */
const offerRestart = async ({ code, signal }) => {
  const { response } = await dialog.showMessageBox({
    type: "error",
    message: "The Margo server stopped",
    detail: `It exited unexpectedly (${code ?? signal ?? "unknown"}), so the app cannot load pages until it is restarted.\n\nLast lines of ${logPath}:\n\n${lastLogLines(10)}`,
    buttons: ["Restart", "Quit"],
    defaultId: 0,
    cancelId: 1,
  });
  quitting = true;
  if (response === 0) app.relaunch();
  app.exit(0);
};

/** Waits for the server this app started to answer. Throws with the log's last lines if it dies or is too slow. */
const waitForServer = async () => {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (serverExit) throw new Error(`The server stopped (code ${serverExit.code ?? serverExit.signal ?? "unknown"}).`);
    if ((await probe(1000)) === "ours") return;
    await sleep(250);
  }
  throw new Error("The server did not answer within 30 seconds.");
};

// ---- Window -------------------------------------------------------------------------------

const readWindowState = () => {
  try {
    const saved = JSON.parse(fs.readFileSync(windowStatePath, "utf8"));
    const state = { width: Math.max(900, saved.width | 0), height: Math.max(600, saved.height | 0) };
    // Only reuse the position when that spot is still on a screen.
    const onScreen = screen.getAllDisplays().some(({ workArea: a }) => saved.x >= a.x - 50 && saved.x < a.x + a.width - 100 && saved.y >= a.y && saved.y < a.y + a.height - 100);
    if (onScreen) Object.assign(state, { x: saved.x, y: saved.y });
    return state;
  } catch {
    return { width: 1280, height: 860 };
  }
};

const saveWindowState = (win) => {
  if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
  try {
    fs.writeFileSync(windowStatePath, JSON.stringify(win.getNormalBounds()));
  } catch {
    // Losing the window position is harmless.
  }
};

const openExternal = (url) => {
  if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
};

const isOurs = (url) => {
  try {
    return new URL(url).origin === ORIGIN;
  } catch {
    return false;
  }
};

/** The microphone, for voice input, and only for this app's own pages. Everything else stays denied. */
const allowMicrophoneForOurPages = () => {
  const allowed = (permission, origin) => permission === "media" && isOurs(origin);
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) =>
    callback(allowed(permission, details.requestingUrl || webContents.getURL())),
  );
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) =>
    allowed(permission, requestingOrigin || webContents?.getURL() || ""),
  );
};

const createWindow = () => {
  const win = new BrowserWindow({
    ...readWindowState(),
    minWidth: 700,
    minHeight: 480,
    // The window colour in the theme macOS is using, so nothing flashes before the page paints.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#ebebed",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  let timer = null;
  const scheduleSave = () => {
    clearTimeout(timer);
    timer = setTimeout(() => saveWindowState(win), 400);
  };
  win.on("resize", scheduleSave);
  win.on("move", scheduleSave);
  win.on("close", () => saveWindowState(win));

  // Links to other sites open in the browser. Links inside the app may open another app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isOurs(url)) return { action: "allow" };
    openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (isOurs(url)) return;
    event.preventDefault();
    openExternal(url);
  });
  win.webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
    // -3 is a navigation that was cancelled on purpose.
    if (isMainFrame && code !== -3) void win.loadURL(`data:text/html,${encodeURIComponent(`<body style="background:#111113;color:#ededf0;font:15px system-ui;padding:40px">Could not reach Margo (${description}). <a href="${ORIGIN}" style="color:#f0b429">Try again</a></body>`)}`);
  });

  void win.loadURL(ORIGIN);
  return win;
};

const showWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  return mainWindow;
};

const buildMenu = () => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      {
        label: "File",
        submenu: [
          { label: "Open in Browser", accelerator: "CmdOrCtrl+Shift+O", click: () => void shell.openExternal(BROWSER_URL) },
          { type: "separator" },
          { role: "close" },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
};

// ---- Start up -----------------------------------------------------------------------------

const fail = async (title, detail) => {
  dialog.showErrorBox(title, detail);
  quitting = true;
  await stopServer();
  app.exit(1);
};

const launch = async () => {
  // The login shell can take seconds to answer, so it runs while the port is probed.
  const shellPath = resolvePath();
  buildMenu();
  allowMicrophoneForOurPages();
  ipcMain.handle("margo:pick-folder", async (event) => {
    // Only the app's own pages may open the picker.
    if (!isOurs(event.senderFrame?.url ?? "")) return null;
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options = { properties: ["openDirectory", "createDirectory"] };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  });

  // A dev server compiling its first route can be slow, so a probe that times out is tried again for a while.
  const giveUp = Date.now() + START_TIMEOUT_MS;
  let found = await probe(5000);
  while (found === "slow" && Date.now() < giveUp) found = await probe(5000);
  if (found === "slow") {
    return fail("Margo is not answering", `Something on port ${PORT} accepted the connection but did not answer for 30 seconds. If it is the dev server, wait for it to finish compiling and open Margo again.`);
  }
  if (found === "other") {
    return fail(`Port ${PORT} is in use`, `Another program is using port ${PORT}, so Margo cannot start. Close that program and open Margo again.`);
  }
  if (found === "free") {
    const serverDir = findServerDir();
    if (!serverDir) {
      return fail("No server to start", "There is no built server. Run `npm run app:server` in the project folder, then `npm run app`.");
    }
    startServer(serverDir, await shellPath);
    try {
      await waitForServer();
    } catch (error) {
      return fail("Margo could not start", `${error.message}\n\nLast lines of ${logPath}:\n\n${lastLogLines(15)}`);
    }
  }
  launched = true;
  createWindow();
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (launched) showWindow();
  });
  // Clicking the Dock icon with no window open brings one back.
  app.on("activate", () => {
    if (launched && !quitting && !BrowserWindow.getAllWindows().length) createWindow();
  });
  // As on any Mac app, closing the last window leaves the app (and its server) running. Quit with Cmd+Q.
  app.on("window-all-closed", () => {});
  // Quit waits for the server to stop, so it is never left running behind a closed app.
  app.on("before-quit", (event) => {
    quitting = true;
    if (!server || serverExit || stopping) return;
    event.preventDefault();
    stopping = true;
    void stopServer().then(() => app.quit());
  });
  // The last resort if the process ends some other way.
  process.on("exit", () => {
    if (server && !serverExit) server.kill("SIGKILL");
  });
  void app.whenReady().then(launch);
}
