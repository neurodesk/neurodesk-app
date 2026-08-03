import * as path from 'path';
import * as fs from 'fs';
import { BrowserWindow } from 'electron';
import { ThemedWindow } from '../dialog/themedwindow';

export class ConsentDialog {
  constructor(options: ConsentDialog.IOptions) {
    this._window = new ThemedWindow({
      isDarkTheme: options.isDarkTheme,
      title: 'Help Improve Neurodesk',
      width: 500,
      height: 340,
      resizable: false,
      preload: path.join(__dirname, './preload.js')
    });

    this._resolve = options.onResult;

    const logoSrc = fs.readFileSync(
      path.join(__dirname, '../../../app-assets/icon.svg')
    );

    this._pageBody = `
      <style>
        .consent-container {
          display: flex;
          flex-direction: column;
          padding: 10px;
          gap: 12px;
        }
        .consent-header {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .consent-header svg {
          width: 48px;
          height: 48px;
          flex-shrink: 0;
        }
        .consent-title {
          font-size: 16px;
          font-weight: 600;
        }
        .consent-body {
          font-size: 13px;
          line-height: 1.5;
        }
        .consent-body ul {
          margin: 6px 0;
          padding-left: 20px;
        }
        .consent-body li {
          margin: 2px 0;
        }
        .consent-note {
          font-size: 12px;
          opacity: 0.7;
          font-style: italic;
        }
        .consent-buttons {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 4px;
        }
      </style>
      <div class="consent-container">
        <div class="consent-header">
          <div>${logoSrc}</div>
          <div class="consent-title">Help improve Neurodesk App</div>
        </div>
        <div class="consent-body">
          <p>Would you like to automatically send crash reports when something goes wrong? This helps us fix bugs faster.</p>
          <p><strong>What we collect:</strong></p>
          <ul>
            <li>Error details and stack traces</li>
            <li>OS, platform, and app version</li>
            <li>Container engine type (Docker/Podman/TinyRange)</li>
            <li>Last 50 lines of the app log</li>
          </ul>
          <p><strong>What we never collect:</strong></p>
          <ul>
            <li>Your files, notebooks, or research data</li>
            <li>Passwords, tokens, or API keys</li>
            <li>Personal paths or directory names</li>
          </ul>
        </div>
        <div class="consent-note">
          You can change this anytime in Settings > Privacy.
        </div>
        <div class="consent-buttons">
          <jp-button onclick="handleDecline()">No thanks</jp-button>
          <jp-button appearance="accent" onclick="handleAccept()">Yes, send crash reports</jp-button>
        </div>
      </div>
      <script>
        function handleAccept() {
          window.electronAPI.setTelemetryConsent('on');
          window.close();
        }
        function handleDecline() {
          window.electronAPI.setTelemetryConsent('off');
          window.close();
        }
      </script>
    `;
  }

  get window(): BrowserWindow {
    return this._window.window;
  }

  load() {
    this._window.window.on('closed', () => {
      this._resolve();
    });
    this._window.loadDialogContent(this._pageBody);
  }

  private _window: ThemedWindow;
  private _pageBody: string;
  private _resolve: () => void;
}

export namespace ConsentDialog {
  export interface IOptions {
    isDarkTheme: boolean;
    onResult: () => void;
  }
}
