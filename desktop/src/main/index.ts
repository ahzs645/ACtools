import { BrowserWindow, app, session, shell } from "electron";
import { join } from "node:path";

import { registerIpc } from "./ipc";

let mainWindow: BrowserWindow | null = null;

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    title: "AC Tools",
    autoHideMenuBar: true,
    icon: join(__dirname, "../../resources/icon.png"),
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // External links (support portal, Connector history) open in the system
  // browser; the app window only ever shows the panel.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  const devServer = process.env.ELECTRON_RENDERER_URL;
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const internal = url.startsWith("file:") || (devServer ? url.startsWith(devServer) : false);
    if (!internal) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Headless smoke test used by CI and `npm run smoke`: log the panel's
  // console, screenshot it once it has settled, then exit non-zero on any
  // renderer error.
  const smokeScreenshot = process.env.AC_TOOLS_SMOKE_SCREENSHOT;
  if (smokeScreenshot) {
    let rendererErrors = 0;
    mainWindow.webContents.on("console-message", (event) => {
      const line = `[renderer:${event.level}] ${event.message}`;
      console.log(line);
      if (event.level === "error") rendererErrors += 1;
    });
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        // Unpackaged builds may also run a bridge exercise in the page
        // (`AC_TOOLS_SMOKE_EVAL`), so CI can prove IPC and storage round-trip.
        const evalSource = process.env.AC_TOOLS_SMOKE_EVAL;
        if (evalSource && !app.isPackaged && mainWindow) {
          try {
            const result: unknown = await mainWindow.webContents.executeJavaScript(evalSource, true);
            console.log(`[smoke] eval result: ${JSON.stringify(result)}`);
          } catch (error) {
            rendererErrors += 1;
            console.log(`[smoke] eval failed: ${String(error)}`);
          }
        }
        const image = await mainWindow?.webContents.capturePage();
        if (image) {
          const { writeFile } = await import("node:fs/promises");
          await writeFile(smokeScreenshot, image.toPNG());
          console.log(`[smoke] screenshot written to ${smokeScreenshot}`);
        }
        app.exit(rendererErrors > 0 ? 1 : 0);
      }, 2500);
    });
  }

  if (devServer) {
    void mainWindow.loadURL(`${devServer}/sidepanel.html`);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/sidepanel.html"));
  }
}

/**
 * The panel is a local file, so it gets the policy the extension manifest
 * would have given it: only its own scripts and styles, its own worker for
 * the PDF parser, and blob/data URLs for generated downloads.
 */
function applyContentSecurityPolicy(): void {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "connect-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'none'"
  ].join("; ");
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url.startsWith("file:")) {
      callback({});
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [policy]
      }
    });
  });
}

void app.whenReady().then(() => {
  applyContentSecurityPolicy();
  registerIpc(() => mainWindow);
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
