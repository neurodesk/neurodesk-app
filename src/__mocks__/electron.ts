export const app = {
  getPath: (name: string) => `/tmp/mock-electron/${name}`,
  getName: () => 'NeurodeskApp',
  getVersion: () => '0.0.0-test',
  on: jest.fn(),
  quit: jest.fn()
};

export const dialog = {
  showMessageBox: jest.fn(),
  showOpenDialog: jest.fn(),
  showErrorBox: jest.fn()
};

export const BrowserWindow = jest.fn().mockImplementation(() => ({
  loadURL: jest.fn(),
  on: jest.fn(),
  webContents: { send: jest.fn(), on: jest.fn() },
  close: jest.fn(),
  show: jest.fn()
}));

export const ipcMain = {
  on: jest.fn(),
  handle: jest.fn()
};

export const nativeTheme = {
  shouldUseDarkColors: false,
  on: jest.fn()
};

export default { app, dialog, BrowserWindow, ipcMain, nativeTheme };
