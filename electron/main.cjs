const { app, BrowserWindow, shell } = require('electron');
const http = require('http');
const next = require('next');

const DEV_URL = process.env.ELECTRON_START_URL || 'http://localhost:3000';
const HOST = process.env.ELECTRON_HOST || '0.0.0.0';
const APP_URL = process.env.APP_URL || null;

let localServer = null;

function createMainWindow(startUrl) {
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#f3f7fb',
    autoHideMenuBar: true,
    title: 'サロン売上・経費ダッシュボード',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(startUrl);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function getLocalStartUrl(port) {
  return `http://127.0.0.1:${port}`;
}

async function startBundledNextServer() {
  const appPath = app.getAppPath();
  const nextApp = next({ dev: false, dir: appPath, hostname: HOST, port: 0 });
  const handle = nextApp.getRequestHandler();

  await nextApp.prepare();

  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      handle(request, response).catch((error) => {
        response.statusCode = 500;
        response.end('Internal server error');
        console.error('Next request handler error:', error);
      });
    });

    server.once('error', reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to determine local server address'));
        return;
      }

      localServer = server;
      resolve(getLocalStartUrl(address.port));
    });
  });
}

app.whenReady().then(() => {
  const open = async () => {
    const startUrl = APP_URL || (app.isPackaged ? await startBundledNextServer() : DEV_URL);
    createMainWindow(startUrl);
  };

  open().catch((error) => {
    console.error('Failed to open desktop window:', error);
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const reopen = async () => {
        const startUrl = APP_URL || (app.isPackaged ? await startBundledNextServer() : DEV_URL);
        createMainWindow(startUrl);
      };

      reopen().catch((error) => {
        console.error('Failed to reopen desktop window:', error);
        app.quit();
      });
    }
  });
});

app.on('window-all-closed', () => {
  if (localServer) {
    localServer.close();
    localServer = null;
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
