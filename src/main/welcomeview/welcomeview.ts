// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { WebContentsView } from 'electron';
import { DarkThemeBGColor, getUserHomeDir, LightThemeBGColor } from '../utils';
import * as path from 'path';
import * as fs from 'fs';
import { appData } from '../config/appdata';
import { EventTypeRenderer } from '../eventtypes';
import { ContainerConfig } from '../config/containerConfigParser';
import * as yaml from 'js-yaml';

interface IRecentSessionListItem {
  isRemote: boolean;
  linkLabel: string;
  linkTooltip: string;
  linkDetail?: string;
}

interface IMiniApp {
  id: string;
  title: string;
  description: string;
  defaultVersion?: string;
  registry?: string;
  releaseHistoryUrl?: string;
  remoteUrl?: string[];
  tags?: string[];
}

// Function to read container installer YAML files and create mini apps
function loadMiniAppsFromContainerInstaller(): IMiniApp[] {
  const containerConfigDir = path.join(__dirname, '../../container_installer');
  const miniApps: IMiniApp[] = [];

  try {
    const files = fs.readdirSync(containerConfigDir);
    const yamlFiles = files.filter(
      file => file.endsWith('.yml') || file.endsWith('.yaml')
    );

    for (const yamlFile of yamlFiles) {
      try {
        const filePath = path.join(containerConfigDir, yamlFile);
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const config = yaml.load(fileContent) as ContainerConfig;

        if (config && config.title && config.description) {
          const app: IMiniApp = {
            id: config.title.toLowerCase().replace(/[^a-z0-9]/g, '-'),
            title: config.title,
            description: config.description.trim(),
            remoteUrl: config.remoteUrl || []
          };

          if (config.defaultVersion) {
            const version = config.defaultVersion;
            try {
              if (
                version &&
                typeof version === 'object' &&
                typeof (version as any).toISOString === 'function'
              ) {
                app.defaultVersion = (version as any)
                  .toISOString()
                  .split('T')[0];
              } else {
                app.defaultVersion = String(version);
              }
            } catch {
              app.defaultVersion = String(version);
            }
          }
          if (config.registry) app.registry = config.registry;
          if (config.releaseHistoryUrl)
            app.releaseHistoryUrl = config.releaseHistoryUrl;
          if (config.remoteUrl) app.remoteUrl = config.remoteUrl;
          if (config.tags) app.tags = config.tags;

          miniApps.push(app);
        }
      } catch (error) {
        console.error(`Error reading YAML file ${yamlFile}:`, error);
      }
    }
  } catch (error) {
    console.error('Error reading container installer directory:', error);
  }

  return miniApps;
}

export class WelcomeView {
  constructor(options: WelcomeView.IOptions) {
    this._isDarkTheme = options.isDarkTheme;
    this._view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, './preload.js'),
        devTools: process.env.NODE_ENV === 'development'
      }
    });

    this._view.setBackgroundColor(
      this._isDarkTheme ? DarkThemeBGColor : LightThemeBGColor
    );

    // Load mini apps from container installer YAML files
    const dynamicMiniApps = loadMiniAppsFromContainerInstaller();
    const miniAppsJson = JSON.stringify(dynamicMiniApps, null, 2);

    this._pageSource = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0">
          <title>Welcome</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }

            body {
              background: ${LightThemeBGColor};
              color: #000000;
              margin: 0;
              overflow: hidden;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica,
                Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji',
                'Segoe UI Symbol';
              font-size: 13px;
              -webkit-user-select: none;
              user-select: none;
              min-height: 100vh;
              padding: 20px;
            }

            body.app-ui-dark {
              background: ${DarkThemeBGColor};
              color: #ffffff;
            }

            .container {
                max-width: 1200px;
                margin: 0 auto;
            }

            .header {
                text-align: center;
                margin-bottom: 40px;
                color: #1f2937;
            }

            .app-ui-dark .header {
                color: #e5e7eb;
            }

            .header h1 {
                font-size: 2.5rem;
                margin-bottom: 10px;
                font-weight: 700;
            }

            .header p {
                font-size: 1.1rem;
                opacity: 0.9;
            }

            .apps-grid {
              display: grid;
              grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
              gap: 24px;
              margin-bottom: 40px;
          }

          .app-card {
              background: white;
              border-radius: 4px;
              padding: 24px;
              box-shadow: 0 3px 6px rgba(0, 0, 0, 0.1);
              transition: all 0.3s ease;
              position: relative;
          }

          .app-ui-dark .app-card {
              background: #4f4f4f;
              box-shadow: 0 3px 6px rgba(0, 0, 0, 0.3);
          }

          .app-card:hover {
              box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
          }

          .app-ui-dark .app-card:hover {
              box-shadow: 0 6px 12px rgba(66, 66, 66, 0.4);
          }

          .app-title {
              font-size: 1.4rem;
              font-weight: 600;
              margin-bottom: 8px;
              color: #2d3748;
          }

          .app-ui-dark .app-title {
              color: #e2e8f0;
          }

          .app-description {
              color: #718096;
              margin-bottom: 16px;
              line-height: 1.5;
          }

          .app-ui-dark .app-description {
              color: #a0aec0;
          }

            .launch-buttons {
                display: flex;
                gap: 12px;
            }

            .launch-btn {
                flex: 1;
                padding: 12px 16px;
                border: none;
                border-radius: 4px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s ease;
                font-size: 0.9rem;
                position: relative;
                overflow: hidden;
            }

            .launch-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            .remote-btn {
                background:rgb(201, 201, 201);
                color: black;
            }

            .remote-btn:hover:not(:disabled) {
                background:rgb(103, 102, 102);
                color: white;
            }

            .local-btn {
                background: #4299e1;
                color: white;
            }

            .local-btn:hover:not(:disabled) {
                background: #3182ce;
            }

            .launch-btn.loading {
                pointer-events: none;
            }

            .launch-btn.loading::after {
                content: '';
                position: absolute;
                top: 50%;
                left: 50%;
                width: 16px;
                height: 16px;
                margin: -8px 0 0 -8px;
                border: 2px solid transparent;
                border-top: 2px solid currentColor;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }

            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }

            /* Split button */
            .split-btn-wrapper {
                flex: 1;
                display: flex;
                position: relative;
            }

            .split-btn-main {
                flex: 1;
                padding: 12px 16px;
                border: none;
                border-radius: 4px 0 0 4px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s ease;
                font-size: 0.9rem;
                background: #4299e1;
                color: white;
            }

            .split-btn-main:hover {
                background: #3182ce;
                color: white;
            }

            .split-btn-arrow {
                padding: 12px 10px;
                border: none;
                border-left: 1px solid rgba(0, 0, 0, 0.15);
                border-radius: 0 4px 4px 0;
                font-size: 0.7rem;
                cursor: pointer;
                transition: all 0.2s ease;
                background: #4299e1;
                color: white;
            }

            .split-btn-arrow:hover {
                background: #3182ce;
                color: white;
            }

            .version-dropdown {
                display: none;
                position: absolute;
                top: 100%;
                left: 0;
                right: 0;
                margin-top: 4px;
                background: white;
                border-radius: 4px;
                box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
                z-index: 100;
                max-height: 250px;
                overflow-y: auto;
            }

            .app-ui-dark .version-dropdown {
                background: #2d2d2d;
                box-shadow: 0 8px 25px rgba(0, 0, 0, 0.4);
            }

            .version-dropdown.open {
                display: block;
            }

            .version-dropdown-item {
                padding: 8px 14px;
                cursor: pointer;
                font-size: 0.85rem;
                color: #2d3748;
                transition: background 0.15s;
            }

            .app-ui-dark .version-dropdown-item {
                color: #e2e8f0;
            }

            .version-dropdown-item:first-child {
                border-radius: 4px 4px 0 0;
            }

            .version-dropdown-item:hover {
                background: rgba(66, 153, 225, 0.1);
            }

            .version-dropdown-item.latest-tag {
                font-weight: 600;
            }

            .version-dropdown-loading {
                padding: 12px 14px;
                font-size: 0.85rem;
                color: #718096;
                text-align: center;
            }

            .version-dropdown-custom {
                padding: 8px 10px;
                border-top: 1px solid rgba(0, 0, 0, 0.1);
            }

            .app-ui-dark .version-dropdown-custom {
                border-top-color: rgba(255, 255, 255, 0.1);
            }

            .version-dropdown-custom input {
                width: 100%;
                padding: 6px 10px;
                border: 1px solid #cbd5e0;
                border-radius: 4px;
                font-size: 0.85rem;
                background: transparent;
                color: inherit;
                box-sizing: border-box;
            }

            .app-ui-dark .version-dropdown-custom input {
                border-color: #4a5568;
            }

            .version-dropdown-custom input::placeholder {
                color: #a0aec0;
            }

            .version-dropdown-custom input:focus {
                outline: none;
                border-color: #4299e1;
            }

            @media (max-width: 768px) {
                .apps-grid {
                    grid-template-columns: 1fr;
                }

                .header h1 {
                    font-size: 2rem;
                }

                .launch-buttons {
                    flex-direction: column;
                }
            }

            .search-container {
                position: relative;
                max-width: 500px;
                margin: 0 auto 40px auto;
            }

            .search-input {
                width: 100%;
                padding: 16px 50px 16px 20px;
                border: none;
                border-radius: 4px;
                background: rgba(255, 255, 255, 0.95);
                backdrop-filter: blur(10px);
                font-size: 1rem;
                color: #2d3748;
                box-shadow: 0 8px 25px rgba(0, 0, 0, 0.1);
                transition: all 0.3s ease;
            }

            .app-ui-dark .search-input {
                background: rgba(81, 81, 81, 0.95);
                color: #e2e8f0;
                box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
            }

            .search-input:focus {
                outline: none;
                background: white;
                box-shadow: 0 12px 35px rgba(0, 0, 0, 0.15);
            }

            .app-ui-dark .search-input:focus {
                background: #2d2d2d;
                box-shadow: 0 12px 35px rgba(0, 0, 0, 0.4);
            }

            .search-input::placeholder {
                color: #a0aec0;
            }

            .search-icon {
                position: absolute;
                right: 16px;
                top: 50%;
                transform: translateY(-50%);
                font-size: 18px;
                color: #a0aec0;
                pointer-events: none;
            }

            #notification-panel {
              position: sticky;
              bottom: 0;
              display: none;
              height: 50px;
              padding: 0 20px;
              background: inherit;
              border-top: 1px solid #585858;
              align-items: center;
            }
            #notification-panel-message {
              flex-grow: 1;
              display: flex;
              align-items: center;
            }
            #notification-panel-message a {
              margin: 0 4px;
            }
            #notification-panel .close-button {
              width: 20px;
              height: 20px;
              fill: #555555;
              cursor: pointer;
            }
            .app-ui-dark #notification-panel .close-button {
              fill: #bcbcbc;
            }
          </style>
          <script>
            document.addEventListener("DOMContentLoaded", () => {
              const platform = "${process.platform}";
              document.body.dataset.appPlatform = platform;
              document.body.classList.add('app-ui-' + platform);
            });
          </script>
        </head>

        <body class="${this._isDarkTheme ? 'app-ui-dark' : ''} title="">
          <svg class="symbol" style="display: none;">
          <defs>
            <symbol id="circle-xmark" viewBox="0 0 512 512">
              <!--! Font Awesome Pro 6.2.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license (Commercial License) Copyright 2022 Fonticons, Inc. --><path d="M256 512c141.4 0 256-114.6 256-256S397.4 0 256 0S0 114.6 0 256S114.6 512 256 512zM175 175c9.4-9.4 24.6-9.4 33.9 0l47 47 47-47c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-47 47 47 47c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-47-47-47 47c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l47-47-47-47c-9.4-9.4-9.4-24.6 0-33.9z"/>
            </symbol>
            <symbol id="triangle-exclamation" viewBox="0 0 512 512">
              <!--! Font Awesome Pro 6.2.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license (Commercial License) Copyright 2022 Fonticons, Inc. --><path d="M256 32c14.2 0 27.3 7.5 34.5 19.8l216 368c7.3 12.4 7.3 27.7 .2 40.1S486.3 480 472 480H40c-14.3 0-27.6-7.7-34.7-20.1s-7-27.8 .2-40.1l216-368C228.7 39.5 241.8 32 256 32zm0 128c-13.3 0-24 10.7-24 24V296c0 13.3 10.7 24 24 24s24-10.7 24-24V184c0-13.3-10.7-24-24-24zm32 224c0-17.7-14.3-32-32-32s-32 14.3-32 32s14.3 32 32 32s32-14.3 32-32z"/></svg>
            </symbol>
          </defs>
          </svg>
          <div class="container">
              <div class="header">
                  <h1>Neurodesk Apps</h1>
                  <p>Launch your applications locally or remotely</p>
              </div>

              <div class="search-container">
                  <input type="text" id="searchInput" placeholder="Search apps..." class="search-input">
                  <div class="search-icon">&#128269;</div>
              </div>

              <div class="apps-grid" id="appsGrid">
                  <!-- Apps will be dynamically generated here -->
              </div>
          </div>
          <div id="notification-panel">
            <div id="notification-panel-message">
            </div>
            <div id="notification-panel-close" title="Close" onclick="closeNotificationPanel(event)">
              <svg class="close-button" version="2.0">
                <use href="#circle-xmark" />
              </svg>
            </div>
          </div>

          <script>

          const notificationPanel = document.getElementById('notification-panel');
          const notificationPanelMessage = document.getElementById('notification-panel-message');
          const notificationPanelCloseButton = document.getElementById('notification-panel-close');

          // Mini apps data loaded from container installer YAML files
          const miniApps = ${miniAppsJson};

          // Function to filter apps based on search term
          function filterApps(searchTerm) {
            if (!searchTerm.trim()) {
                return miniApps;
            }

            const term = searchTerm.toLowerCase();
            return miniApps.filter(app =>
                app.title.toLowerCase().includes(term) ||
                app.description.toLowerCase().includes(term)
            );
          }

          // Function to create app card HTML
          function createAppCard(app) {
              const hasReleaseHistory = !!app.releaseHistoryUrl;
              const localButton = hasReleaseHistory
                ? \`<div class="split-btn-wrapper">
                      <button class="split-btn-main"
                              onclick="handleNewSessionClick('notebook', '\$\{app.title\}', null)">
                          Launch Local
                      </button>
                      <button class="split-btn-arrow"
                              onclick="toggleVersionDropdown(event, '\$\{app.id\}')">
                          &#9660;
                      </button>
                      <div class="version-dropdown" id="dropdown-\$\{app.id\}"
                           data-release-url="\$\{app.releaseHistoryUrl\}"
                           data-default-version="\$\{app.defaultVersion || ''}\}"
                           data-app-title="\$\{app.title\}"
                           data-loaded="false">
                      </div>
                  </div>\`
                : \`<button class="launch-btn local-btn"
                          onclick="handleNewSessionClick('notebook', '\$\{app.title\}', null)">
                      Launch Local
                  </button>\`;

              return \`
                  <div class="app-card" id="\$\{app.id\}">
                      <h3 class="app-title">\$\{app.title\}</h3>
                      <p class="app-description">\$\{app.description\}</p>

                      <div class="launch-buttons">
                          \$\{localButton\}
                          <button class="launch-btn remote-btn"
                                  onclick="handleNewRemoteSessionClick('remote', '\$\{app.remoteUrl\}');location.href='javascript:void(0)'">
                              Launch Remote
                          </button>
                      </div>
                  </div>
              \`;
          }

          // Function to render all apps (updated to handle filtering)
          function renderApps(filteredApps = miniApps) {
              const appsGrid = document.getElementById('appsGrid');

              if (filteredApps.length === 0) {
                  appsGrid.innerHTML = \`
                      <div style="grid-column: 1 / -1; text-align: center; padding: 40px;">
                          <h3 style="margin-bottom: 8px;">No apps found</h3>
                          <p style="opacity: 0.8;">Try adjusting your search terms</p>
                      </div>
                  \`;
                  return;
              }

              const appsHTML = filteredApps.map(createAppCard).join('');

              appsGrid.innerHTML = appsHTML;
          }

          // Add search functionality
          const searchInput = document.getElementById('searchInput');
          searchInput.addEventListener('input', (e) => {
              const searchTerm = e.target.value;
              const filteredApps = filterApps(searchTerm);
              renderApps(filteredApps);
          });

          // Initialize the app
          document.addEventListener('DOMContentLoaded', () => {
              renderApps();
          });

          window.electronAPI.onSetRecentSessionList((recentSessions, resetCollapseState) => {
            // Recent sessions handled by mini apps view
          });

          document.addEventListener('dragover', (event) => {
            event.preventDefault();
            event.stopPropagation();
          });

          document.addEventListener('drop', (event) => {
            event.preventDefault();
            event.stopPropagation();

            const files = [];
            for (const file of event.dataTransfer.files) {
              files.push(file.path);
            }

            window.electronAPI.openDroppedFiles(files);
          });

          function handleNewSessionClick(type, containerConfigName, imageVersion) {
            window.electronAPI.newSession(type, containerConfigName, undefined, imageVersion || undefined);
          }

          function handleNewRemoteSessionClick(type, remoteUrl) {
            // Parse the comma-separated string back to array
            const remoteUrlArray = typeof remoteUrl === 'string' ? remoteUrl.split(',') : remoteUrl;
            window.electronAPI.newSession(type, undefined, remoteUrlArray);
          }

          // Close any open dropdown when clicking outside
          document.addEventListener('click', (e) => {
            document.querySelectorAll('.version-dropdown.open').forEach(dd => {
              if (!dd.parentElement.contains(e.target)) {
                dd.classList.remove('open');
              }
            });
          });

          async function toggleVersionDropdown(event, appId) {
            event.stopPropagation();
            const dropdown = document.getElementById('dropdown-' + appId);
            if (!dropdown) return;

            // Toggle visibility
            if (dropdown.classList.contains('open')) {
              dropdown.classList.remove('open');
              return;
            }

            // Close other open dropdowns
            document.querySelectorAll('.version-dropdown.open').forEach(dd => {
              dd.classList.remove('open');
            });

            dropdown.classList.add('open');

            // Load versions if not already loaded
            if (dropdown.dataset.loaded === 'false') {
              dropdown.innerHTML = '<div class="version-dropdown-loading">Loading versions...</div>';

              const releaseUrl = dropdown.dataset.releaseUrl;
              const defaultVersion = dropdown.dataset.defaultVersion;
              const appTitle = dropdown.dataset.appTitle;

              try {
                const versions = await window.electronAPI.fetchReleases(releaseUrl, defaultVersion);
                renderDropdownItems(dropdown, versions, appTitle);
                dropdown.dataset.loaded = 'true';
              } catch (err) {
                dropdown.innerHTML = '<div class="version-dropdown-loading">Failed to load versions</div>';
              }
            }
          }

          function renderDropdownItems(dropdown, versions, appTitle) {
            let html = '';
            versions.forEach((version, i) => {
              const label = i === 0 ? version + ' (Latest)' : version;
              const cls = i === 0 ? 'version-dropdown-item latest-tag' : 'version-dropdown-item';
              html += '<div class="' + cls + '" onclick="selectVersion(\\'' + appTitle + '\\', \\'' + version + '\\')">' + label + '</div>';
            });

            // Custom tag input
            html += '<div class="version-dropdown-custom">';
            html += '<input type="text" placeholder="Custom tag (e.g. pre-release)" '
                  + 'onkeydown="handleCustomTag(event, \\'' + appTitle + '\\')" />';
            html += '</div>';

            dropdown.innerHTML = html;
          }

          function selectVersion(appTitle, version) {
            // Close all dropdowns
            document.querySelectorAll('.version-dropdown.open').forEach(dd => {
              dd.classList.remove('open');
            });
            handleNewSessionClick('notebook', appTitle, version);
          }

          function handleCustomTag(event, appTitle) {
            if (event.key === 'Enter') {
              const tag = event.target.value.trim();
              if (tag) {
                document.querySelectorAll('.version-dropdown.open').forEach(dd => {
                  dd.classList.remove('open');
                });
                handleNewSessionClick('notebook', appTitle, tag);
              }
            }
          }

          function sendMessageToMain(message, ...args) {
            window.electronAPI.sendMessageToMain(message, ...args);
          }

          function showNotificationPanel(message, closable) {
            notificationPanelMessage.innerHTML = message;
            notificationPanel.style.display = "flex";
            notificationPanelCloseButton.style.display = closable ? 'block' : 'none';
          }

          function closeNotificationPanel() {
            notificationPanel.style.display = "none";
          }

          window.electronAPI.onSetNotificationMessage((message, closable) => {
            showNotificationPanel(message, closable);
          });

          </script>
        </body>
      </html>
      `;
  }

  get view(): WebContentsView {
    return this._view;
  }

  load() {
    this._view.webContents.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(this._pageSource)}`
    );

    this._viewReady = new Promise<void>(resolve => {
      this._view.webContents.on('dom-ready', () => {
        resolve();
      });
    });

    this.updateRecentSessionList(true);
  }

  showNotification(message: string, closable: boolean) {
    this._viewReady.then(() => {
      this._view.webContents.send(
        EventTypeRenderer.SetNotificationMessage,
        message,
        closable
      );
    });
  }

  updateRecentSessionList(resetCollapseState: boolean) {
    const recentSessionList: IRecentSessionListItem[] = [];
    const home = getUserHomeDir();

    for (const recentSession of appData.recentSessions) {
      let sessionItem = '';
      let sessionDetail = '';
      let tooltip = '';
      if (recentSession.remoteURL) {
        const url = new URL(recentSession.remoteURL);
        sessionItem = url.origin;
        tooltip = `${recentSession.remoteURL}\nSession data ${
          recentSession.persistSessionData ? '' : 'not '
        }persisted`;
        sessionDetail = '';
      } else {
        sessionItem = path.join(home, 'neurodesktop-storage');
        tooltip = path.join(home, 'neurodesktop-storage');
      }

      recentSessionList.push({
        isRemote: !!recentSession.remoteURL,
        linkLabel: sessionItem,
        linkTooltip: tooltip,
        linkDetail: sessionDetail
      });
    }

    this._viewReady.then(() => {
      this._view.webContents.send(
        EventTypeRenderer.SetRecentSessionList,
        recentSessionList,
        resetCollapseState
      );
    });
  }

  private _isDarkTheme: boolean;
  private _view: WebContentsView;
  private _viewReady: Promise<void>;
  private _pageSource: string;
}

export namespace WelcomeView {
  export interface IOptions {
    isDarkTheme: boolean;
  }
}
