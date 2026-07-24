// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import * as ejs from 'ejs';
import { BrowserWindow } from 'electron';
import * as path from 'path';
import { ThemedWindow } from '../dialog/themedwindow';
import {
  CtrlWBehavior,
  CvmfsMode,
  EngineType,
  // FrontEndMode,
  KeyValueMap,
  LogLevel,
  // serverLaunchArgsDefault,
  // serverLaunchArgsFixed,
  StartupMode,
  ThemeType
} from '../config/settings';
export class SettingsDialog {
  constructor(options: SettingsDialog.IOptions) {
    this._window = new ThemedWindow({
      isDarkTheme: options.isDarkTheme,
      title: 'Settings',
      width: 700,
      height: 400,
      preload: path.join(__dirname, './preload.js')
    });

    const {
      engineType,
      startupMode,
      cvmfsMode,
      theme,
      // syncJupyterLabTheme,
      // showNewsFeed,
      // frontEndMode,
      checkForUpdatesAutomatically,
      defaultWorkingDirectory,
      neurodesktopStorageDirectory,
      logLevel,
      serverArgs,
      // overrideDefaultServerArgs,
      serverEnvVars,
      ctrlWBehavior
    } = options;
    const installUpdatesAutomaticallyEnabled = process.platform === 'darwin';
    const installUpdatesAutomatically =
      installUpdatesAutomaticallyEnabled && options.installUpdatesAutomatically;

    let strServerEnvVars = '';
    if (Object.keys(serverEnvVars).length > 0) {
      for (const key in serverEnvVars) {
        strServerEnvVars += `${key}= "${serverEnvVars[key]}"\n`;
      }
    }

    const ctrlWLabel = process.platform === 'darwin' ? 'Cmd + W' : 'Ctrl + W';

    const template = `
      <style>
      #container {
        display: flex;
        flex-direction: column;
        height: 100%;
      }
      #content-area {
        display: flex;
        flex-direction: row;
        column-gap: 20px;
        flex-grow: 1;
        overflow-y: auto;
      }
      #categories {
        width: 200px;
      }
      #category-content-container {
        flex-grow: 1;
      }
      .category-content {
        display: flex;
        flex-direction: column;
      }
      #footer {
        text-align: right;
      }
      #category-jupyterlab jp-divider {
        margin: 15px 0;
      }
      #server-config-section {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
      }
      jp-tab-panel #tab-updates {
        display: flex;
        align-items: flex-start;
      }
      #category-tabs {
        width: 100%;
      }
      #bundled-env-warning {
        display: none;
        align-items: center;
      }
      #bundled-env-warning.warning {
        color: orange;
      }
      #install-bundled-env {
        display: none;
      }
      #update-bundled-env {
        display: none;
      }
      .row {
        display: flex;
        align-items: center;
      }
      .footer-row {
        height: 50px;
        min-height: 50px;
        overflow-y: hidden;
        display: flex;
        flex-direction: row;
        justify-content: flex-end;
        align-items: center;
      }
      .progress-message {
        margin-right: 5px; line-height: 24px; visibility: hidden;
      }
      .progress-animation {
        margin-right: 5px; visibility: hidden;
      }
      #news-feed-settings {
        display: flex;
        flex-direction: column;
        margin: 10px 0;
      }
      #clear-history {
        display: flex;
        flex-direction: column;
      }
      #clear-history-progress {
        visibility: hidden;
      }
      .setting-section {
        margin: 10px 0;
        display: flex;
        flex-direction: column;
        align-items: baseline;
      }
      #additional-server-args,
      #server-launch-command-preview,
      #additional-server-env-vars {
        width: 100%;
      }
      #additional-server-args::part(control) {
        height: 40px;
      }
      #tab-panel-server {
        padding-bottom: 20px;
      }
      #additional-server-env-vars.invalid::part(control) {
        border-color: red;
      }
      .tooltip {
        position: relative;
        display: inline-block;
        border-bottom: 1px dotted black; /* If you want dots under the hoverable text */
      }

      /* Tooltip text */
      .tooltip .tooltiptext {
        visibility: hidden;
        width: 350px;
        background-color: #424242;
        color: #fff;
        text-align: left;
        padding: 5px 10px 5px 0;
        border-radius: 6px;
        /* Position the tooltip text - see examples below! */
        position: absolute;
        z-index: 1;
      }

      /* Show the tooltip text when you mouse over the tooltip container */
      .tooltip:hover .tooltiptext {
        visibility: visible;
      }
      </style>
      <div id="container">
        <div id="content-area">
          <jp-tabs id="category-tabs" false="" orientation="vertical">
            <jp-tab id="tab-general">General</jp-tab>
            <jp-tab id="tab-server">Additional Directory</jp-tab>
            <jp-tab id="tab-privacy">Privacy</jp-tab>
            <jp-tab id="tab-advanced">Advanced</jp-tab>

            <jp-tab-panel id="tab-panel-general">
              <jp-radio-group orientation="horizontal">
                <label slot="label">Engine Options</label>
                <jp-radio name="engine-type" value="docker" <%= engineType === 'docker' ? 'checked' : '' %>>Docker</jp-radio>
                <jp-radio name="engine-type" value="podman" <%= engineType === 'podman' ? 'checked' : '' %>>Podman</jp-radio>
                <jp-radio name="engine-type" value="tinyrange" <%= engineType === 'tinyrange' ? 'checked' : '' %>>TinyRange</jp-radio>
                <% if (isWindows) { %>
                <jp-radio name="engine-type" value="wslc" <%= engineType === 'wslc' ? 'checked' : '' %>>WSL</jp-radio>
                <% } %>
                </jp-radio-group>

              <jp-radio-group orientation="horizontal">
                <label slot="label">On startup</label>
                <jp-radio name="startup-mode" value="welcome-page" <%= startupMode === 'welcome-page' ? 'checked' : '' %>>Show welcome page</jp-radio>
              </jp-radio-group>

              <jp-radio-group orientation="horizontal">
                <label slot="label">Container mode 
                  <div class="tooltip">&#9432;
                    <span class="tooltiptext">
                    <ul>
                      <li>Download: Downloads containers when there is internet connection and allow to use them when internet is disconnected.</li>
                      <li>Stream: Always fetches the latest containers but requires an internet connection</li>
                    </ul>
                    </span>
                  </div>
                </label>
                <jp-radio name="cvmfs-mode" value="false" <%= cvmfsMode === 'false' ? 'checked' : '' %>>Stream</jp-radio>
                <jp-radio name="cvmfs-mode" value="true" <%= cvmfsMode === 'true' ? 'checked' : '' %>>Download</jp-radio>
              </jp-radio-group>
              
              <jp-radio-group orientation="horizontal">
                <label slot="label">Theme</label>
                <jp-radio name="theme" value="light" <%= theme === 'light' ? 'checked' : '' %>>Light</jp-radio>
                <jp-radio name="theme" value="dark" <%= theme === 'dark' ? 'checked' : '' %>>Dark</jp-radio>
                <jp-radio name="theme" value="system" <%= theme === 'system' ? 'checked' : '' %>>System</jp-radio>
              </jp-radio-group>

            </jp-tab-panel>

            <jp-tab-panel id="tab-panel-server">
              <div class="row" style="line-height: 30px;">
                <label>Neurodesk storage directory</label>
              </div>
              <div class="row">
                <div style="flex-grow: 1;">
                  <jp-text-field type="text" id="storage-directory" value="<%= neurodesktopStorageDirectory %>" style="width: 100%;" spellcheck="false" placeholder="<%= defaultStoragePlaceholder %> (default)"></jp-text-field>
                </div>
                <div>
                  <jp-button id='select-storage-directory' onclick='handleSelectStorageDirectory(this);'>Change</jp-button>
                </div>
              </div>
              <div class="row" style="line-height: 30px; opacity: 0.7; font-size: 12px;">
                <label>Takes effect on next session</label>
              </div>

              <div class="row" style="line-height: 30px; margin-top: 10px;">
                <label>Additional working directory</label>
              </div>
              <div class="row">
                <div style="flex-grow: 1;">
                  <jp-text-field type="text" id="working-directory" value="<%= defaultWorkingDirectory %>" style="width: 100%;" spellcheck="false" placeholder="/working/directory (leave empty for user home)"></jp-text-field>
                </div>
                <div>
                  <jp-button id='select-working-directory' onclick='handleSelectWorkingDirectory(this);'>Change</jp-button>
                </div>
              </div>

              <script>
                const storageDirectoryInput = document.getElementById('storage-directory');
                window.electronAPI.onStorageDirectorySelected((path) => {
                  storageDirectoryInput.value = path;
                });
                function handleSelectStorageDirectory(el) {
                  window.electronAPI.selectStorageDirectory();
                }

                const workingDirectoryInput = document.getElementById('working-directory');
                window.electronAPI.onWorkingDirectorySelected((path) => {
                  workingDirectoryInput.value = path;
                });
                function handleSelectWorkingDirectory(el) {
                  window.electronAPI.selectWorkingDirectory();
                }
              </script>
            </jp-tab-panel>

            <jp-tab-panel id="tab-panel-privacy">
              <div id="clear-history">
                <div class="row" style="line-height: 30px;">
                  <label>Clear History</label>
                </div>
                <jp-checkbox id='checkbox-clear-session-data' type='checkbox' checked="true">Browser session cache & data</jp-checkbox>
                <jp-checkbox id='checkbox-clear-recent-remote-urls' type='checkbox'>Recent remote URLs</jp-checkbox>
                <jp-checkbox id='checkbox-clear-recent-sessions' type='checkbox'>Recent sessions</jp-checkbox>
              

                <div class="row" style="height: 60px">
                <jp-button onclick='handleClearHistory(this);'>Clear selected</jp-button><jp-progress-ring id="clear-history-progress"></jp-progress-ring>
                </div>
              </div>
              <script>
                const clearSessionDataCheckbox = document.getElementById('checkbox-clear-session-data');
                const clearRecentRemoteURLs = document.getElementById('checkbox-clear-recent-remote-urls');
                const clearRecentSessions = document.getElementById('checkbox-clear-recent-sessions');
                const clearUserSetPythonEnvs = document.getElementById('checkbox-clear-user-set-python-envs');
                const clearHistoryProgress = document.getElementById('clear-history-progress');

                function handleClearHistory(el) {
                  clearHistoryProgress.style.visibility = 'visible';
                  window.electronAPI.clearHistory({
                    sessionData: clearSessionDataCheckbox.checked,
                    recentRemoteURLs: clearRecentRemoteURLs.checked,
                    recentSessions: clearRecentSessions.checked
                  }).then(() => {
                    clearHistoryProgress.style.visibility = 'hidden';
                  });
                }
              </script>
            </jp-tab-panel>

            <jp-tab-panel id="tab-panel-advanced">
              <div class="row setting-section">
                <jp-radio-group orientation="horizontal">
                  <label slot="label">${ctrlWLabel} behavior</label>
                  <jp-radio name="ctrl-w-behavior" value="close-tab" <%= ctrlWBehavior === 'close-tab' ? 'checked' : '' %>>Close tab</jp-radio>
                  <jp-radio name="ctrl-w-behavior" value="close" <%= ctrlWBehavior === 'close' ? 'checked' : '' %>>Close session</jp-radio>
                  <jp-radio name="ctrl-w-behavior" value="warn" <%= ctrlWBehavior === 'warn' ? 'checked' : '' %>>Warn and close session</jp-radio>
                  <jp-radio name="ctrl-w-behavior" value="do-not-close" <%= ctrlWBehavior === 'do-not-close' ? 'checked' : '' %>>Do not close</jp-radio>
                </jp-radio-group>
              </div>

              <div class="row setting-section">
                <div class="row">
                  <label for="log-level">Log level</label>
                </div>

                <div class="row">
                  <jp-select id="log-level" name="log-level" value="<%= logLevel %>" position="below" onchange="onLogLevelChanged(this)">
                    <jp-option value="error">Error</jp-option>
                    <jp-option value="warn">Warn</jp-option>
                    <jp-option value="info">Info</jp-option>
                    <jp-option value="verbose">Verbose</jp-option>
                    <jp-option value="debug">Debug</jp-option>
                  </jp-select>
                  <jp-button onclick='handleShowLogs(this);'>Show logs</jp-button>
                </div>
              </div>

              <div class="row setting-section">
                <div class="row">
                  <jp-checkbox id='checkbox-update-check' type='checkbox' <%= checkForUpdatesAutomatically ? 'checked' : '' %> onchange='handleAutoCheckForUpdates(this);'>Check for updates automatically</jp-checkbox>
                </div>
                <div class="row">
                  <jp-checkbox id='checkbox-update-install' type='checkbox' <%= installUpdatesAutomatically ? 'checked' : '' %> <%= installUpdatesAutomaticallyEnabled ? '' : 'disabled' %>>Download and install updates automatically</jp-checkbox>
                </div>
                <div class="row">
                  <jp-button onclick='handleCheckForUpdates(this);'>Check for updates now</jp-button>
                </div>
              </div>

              <script>
                const autoUpdateCheckCheckbox = document.getElementById('checkbox-update-check');
                const autoInstallCheckbox = document.getElementById('checkbox-update-install');

                function handleAutoCheckForUpdates(el) {
                  updateAutoInstallCheckboxState();
                }

                function updateAutoInstallCheckboxState() {
                  if (<%= installUpdatesAutomaticallyEnabled ? 'true' : 'false' %> /* installUpdatesAutomaticallyEnabled */ &&
                    autoUpdateCheckCheckbox.checked) {
                    autoInstallCheckbox.removeAttribute('disabled');
                  } else {
                    autoInstallCheckbox.setAttribute('disabled', 'disabled');
                  }
                }

                function handleCheckForUpdates(el) {
                  window.electronAPI.checkForUpdates();
                }

                function onLogLevelChanged(el) {
                  window.electronAPI.setLogLevel(el.value);
                }
                
                function handleShowLogs(el) {
                  window.electronAPI.showLogs();
                }
                
                document.addEventListener("DOMContentLoaded", () => {
                  updateAutoInstallCheckboxState();
                });
              </script>
            </jp-tab-panel>
          </jp-tabs>
        </div>
        <div id="footer" class="footer-row">
          <div id="progress-message" class="progress-message"></div>
          <div id="progress-animation" class="progress-animation"><jp-progress-ring></jp-progress-ring></div>
          <jp-button id="apply" appearance="accent" onclick='handleApply(this);'>Apply & restart</jp-button>
        </div>
      </div>
      <script>
        const applyButton = document.getElementById('apply');
        const progressMessage = document.getElementById('progress-message');
        const progressAnimation = document.getElementById('progress-animation');
        let defaultPythonEnvChanged = false;

        function showProgress(message, animate) {
          progressMessage.innerText = message;
          progressMessage.style.visibility = message !== '' ? 'visible' : 'hidden';
          progressAnimation.style.visibility = animate ? 'visible' : 'hidden';
        }

        function handleApply() {
          const engineType = document.querySelector('jp-radio[name="engine-type"].checked').value;
          window.electronAPI.setEngineType(engineType);
          const startupMode = document.querySelector('jp-radio[name="startup-mode"].checked').value;
          window.electronAPI.setStartupMode(startupMode);
          const cvmfsMode = document.querySelector('jp-radio[name="cvmfs-mode"].checked').value;
          window.electronAPI.setCvmfsMode(cvmfsMode);
          const theme = document.querySelector('jp-radio[name="theme"].checked').value;
          window.electronAPI.setTheme(theme);


          window.electronAPI.setCheckForUpdatesAutomatically(autoUpdateCheckCheckbox.checked);
          window.electronAPI.setInstallUpdatesAutomatically(autoInstallCheckbox.checked);
          window.electronAPI.setStorageDirectory(storageDirectoryInput.value);
          window.electronAPI.setDefaultWorkingDirectory(workingDirectoryInput.value);
          if (workingDirectoryInput.value !== '') {
            window.electronAPI.setServerLaunchArgs(workingDirectoryInput.value);
          }

          const ctrlWBehavior = document.querySelector('jp-radio[name="ctrl-w-behavior"].checked').value;
          window.electronAPI.setCtrlWBehavior(ctrlWBehavior);


          window.electronAPI.restartApp();
        }

        ${
          options.activateTab
            ? `
          document.addEventListener("DOMContentLoaded", () => {
            document.getElementById('tab-${options.activateTab}').click();
          });
        `
            : ''
        }
        
      </script>
    `;
    this._pageBody = ejs.render(template, {
      engineType,
      isWindows: process.platform === 'win32',
      startupMode,
      cvmfsMode,
      theme,
      // syncJupyterLabTheme,
      // showNewsFeed,
      checkForUpdatesAutomatically,
      installUpdatesAutomaticallyEnabled,
      installUpdatesAutomatically,
      // frontEndMode,
      defaultWorkingDirectory,
      neurodesktopStorageDirectory,
      defaultStoragePlaceholder:
        process.platform === 'win32'
          ? 'C:/neurodesktop-storage'
          : '~/neurodesktop-storage',
      logLevel,
      serverArgs,
      // overrideDefaultServerArgs,
      serverEnvVars: strServerEnvVars,
      ctrlWBehavior
    });
  }

  get window(): BrowserWindow {
    return this._window.window;
  }

  load() {
    this._window.loadDialogContent(this._pageBody);
  }

  private _window: ThemedWindow;
  private _pageBody: string;
}

export namespace SettingsDialog {
  export enum Tab {
    General = 'general',
    Server = 'server',
    Updates = 'updates'
  }

  export interface IOptions {
    isDarkTheme: boolean;
    engineType: EngineType;
    startupMode: StartupMode;
    cvmfsMode: CvmfsMode;
    theme: ThemeType;
    // syncJupyterLabTheme: boolean;
    // showNewsFeed: boolean;
    // frontEndMode: FrontEndMode;
    checkForUpdatesAutomatically: boolean;
    installUpdatesAutomatically: boolean;
    defaultWorkingDirectory: string;
    neurodesktopStorageDirectory: string;
    // defaultPythonPath: string;
    activateTab?: Tab;
    logLevel: LogLevel;
    serverArgs: string;
    // overrideDefaultServerArgs: boolean;
    serverEnvVars: KeyValueMap;
    ctrlWBehavior: CtrlWBehavior;
  }
}
