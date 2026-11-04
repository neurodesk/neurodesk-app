// Runs the real application/session/server classes, not a replacement UI.
const { app, powerSaveBlocker, nativeImage } = require('electron');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
const fs = require('fs');
const path = require('path');
const assert = require('assert').strict;
const run = process.env.NEURODESK_ACCEPTANCE_DIR;
if (
  !run ||
  !path.resolve(run).startsWith(path.resolve(__dirname, '../build') + path.sep)
) {
  throw new Error('Acceptance requires an isolated build/ directory');
}
const gpu = process.env.NEURODESK_ACCEPTANCE_GPU === '1';
const profile = path.join(run, 'profile');
const storage = path.join(run, 'storage');
const directory = path.join(run, 'data');
for (const dir of [profile, storage, directory]) {
  fs.mkdirSync(dir, { recursive: true });
}
app.setAppPath(path.resolve(__dirname, '..'));
app.setPath('userData', profile);
app.setPath('logs', path.join(run, 'logs'));
fs.writeFileSync(
  path.join(profile, 'settings.json'),
  JSON.stringify({
    engineType: 'crumblecracker',
    gpuAcceleration: gpu,
    startupMode: 'new-local-session',
    defaultWorkingDirectory: directory,
    neurodesktopStorageDirectory: storage,
    checkForUpdatesAutomatically: false,
    installUpdatesAutomatically: false,
    showNewsFeed: false
  })
);
const report = {
  gpuRequested: gpu,
  candidate: process.env.NEURODESK_CC_IMAGE,
  stages: []
};
const save = () =>
  fs.writeFileSync(
    path.join(run, 'report.json'),
    JSON.stringify(report, null, 2)
  );
const stage = name => {
  report.stages.push(name);
  save();
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(description, fn, timeout = 180000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await Promise.race([
      fn(),
      sleep(15000).then(() => {
        throw new Error('UI probe stalled: ' + description);
      })
    ]);
    if (result) {
      return result;
    }
    await sleep(300);
  }
  throw new Error('Timed out: ' + description);
}
let application;
let server;
let lab;
process.on('SIGTERM', () => app.quit());
process.on('SIGINT', () => app.quit());
app.whenReady().then(async () => {
  try {
    powerSaveBlocker.start('prevent-display-sleep');
    const { JupyterApplication } = require('../build/out/main/app');
    application = new JupyterApplication({
      _: [],
      cwd: directory,
      workingDir: directory
    });
    stage('application-launched');
    const window = await until(
      'session window',
      () => application._sessionWindowManager.windows[0]
    );
    server = await until(
      'server assignment',
      () => window._server?.server,
      40 * 60 * 1000
    );
    await server.started;
    stage('jupyter-authenticated');
    const backend = server._crumble;
    assert(backend, 'real CrumbleCracker backend required');
    stage('checking-pre-desktop-services');
    const before = await backend.diagnostics();
    report.beforeDesktop = before;
    assert(!before.services.includes('x11-ready'), 'Jupyter must precede Xorg');
    assert(
      before.services.split('\n')[0] === 'active',
      'Jupyter service must be active'
    );
    stage('pre-desktop-services-checked');
    const unauthorized = await fetch(
      `http://127.0.0.1:${server.info.port}/api/status`,
      { redirect: 'manual' }
    );
    assert(
      [401, 403].includes(unauthorized.status),
      'Jupyter must require authentication'
    );
    stage('authentication-required');
    lab = await until('lab view', () => window.labView?.view.webContents);
    stage('lab-view-created');
    window.window.restore();
    window.window.show();
    window.window.focus();
    lab.setBackgroundThrottling(false);
    report.console = [];
    lab.on('console-message', (_event, ...args) => {
      const msg = typeof args[0] === 'object' ? args[0].message : args[1];
      if (typeof msg === 'string') {
        report.console.push(
          msg
            .replace(/[a-f0-9]{64}/gi, '[redacted]')
            .replace(/token=[^&\s]+/gi, 'token=[redacted]')
            .slice(0, 1000)
        );
        if (report.console.length > 30) {
          report.console.shift();
        }
        save();
      }
    });
    await until('native launcher card', () =>
      lab.executeJavaScript(
        "!!document.querySelector('[data-neurodesk-native-desktop] button')"
      )
    );
    await lab.executeJavaScript(
      "document.querySelector('[data-neurodesk-native-desktop]').scrollIntoView({block: 'center'})"
    );
    await sleep(3000);
    stage('jupyter-launcher-visible');
    fs.writeFileSync(
      path.join(run, 'jupyter.png'),
      (await lab.capturePage()).toPNG()
    );
    const titlebar = window.titleBarView.view.webContents;
    await until('desktop top bar button', () =>
      titlebar.executeJavaScript(
        "!!document.querySelector('#native-desktop-button:not([hidden])')"
      )
    );
    const openTopBar = () =>
      titlebar.executeJavaScript(
        "document.getElementById('native-desktop-button').click()"
      );
    const openLauncher = () =>
      lab.executeJavaScript(
        "document.querySelector('[data-neurodesk-native-desktop] button').click()"
      );
    await (gpu ? openTopBar() : openLauncher());
    await until('native frame presentation', async () => {
      const state = await backend.api(`/v1/vms/${backend.vm}`);
      if (state.glass?.state === 'failed') {
        throw new Error('Glass presentation failed');
      }
      return state.glass?.state === 'open';
    });
    stage(
      gpu ? 'top-bar-opened-native-window' : 'launcher-opened-native-window'
    );
    // The second entry point must target the same VM/window, not restart it.
    await (gpu ? openLauncher() : openTopBar());
    await sleep(1500);
    report.afterDesktop = await backend.diagnostics();
    assert(
      report.afterDesktop.services.includes('x11-ready'),
      'desktop must be live'
    );
    assert.equal(
      report.afterDesktop.graphics_exit_code,
      0,
      'glxinfo must execute'
    );
    if (gpu) {
      assert(
        /virgl/i.test(report.afterDesktop.graphics),
        'GPU must report virgl'
      );
      assert(
        !/llvmpipe|softpipe|swrast/i.test(report.afterDesktop.graphics),
        'software fallback is not GPU acceptance'
      );
    }
    await sleep(15000);
    const desktop = await until(
      'nonblank native desktop frame',
      async () => {
        const png = await backend.screenshot();
        const bitmap = nativeImage.createFromBuffer(png).toBitmap();
        const colors = new Set();
        for (let i = 0; i < bitmap.length; i += 64) {
          colors.add(bitmap.readUInt32LE(i));
        }
        report.desktopColors = colors.size;
        save();
        return colors.size > 32 ? png : null;
      },
      120000
    );
    fs.writeFileSync(path.join(run, 'desktop.png'), desktop);
    stage('launcher-action-and-desktop-capture-passed');
    await server.stop();
    stage('owned-backend-shutdown');
    report.success = true;
    save();
    app.quit();
  } catch (error) {
    report.success = false;
    report.error = String(error);
    save();
    if (lab && !lab.isDestroyed()) {
      try {
        report.labState = await Promise.race([
          lab.executeJavaScript(
            `({path: location.pathname, title: document.title, launcherBodies: document.querySelectorAll('.jp-Launcher-body').length, launchers: document.querySelectorAll('.jp-Launcher').length, bridge: !!window.electronAPI, body: document.body.textContent.slice(-3000), children: [...document.body.children].map(n => n.tagName + '.' + n.className), scripts: [...document.scripts].map(s => { try { return new URL(s.src).pathname; } catch (_) { return 'inline'; } })})`
          ),
          sleep(5000).then(() => 'renderer-unresponsive')
        ]);
        save();
        const image = await Promise.race([
          application._sessionWindowManager.windows[0].window.capturePage(),
          sleep(5000).then(() => null)
        ]);
        if (image) {
          fs.writeFileSync(path.join(run, 'failure.png'), image.toPNG());
        }
      } catch (_) {
        /* Keep original error and always stop the owned backend. */
      }
    }
    try {
      if (server) {
        await server.stop();
      }
    } catch (cleanup) {
      report.cleanupError = String(cleanup);
      save();
    }
    app.exit(1);
  }
});
