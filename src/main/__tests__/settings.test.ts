import {
  CvmfsMode,
  EngineType,
  StartupMode,
  ThemeType
} from '../config/settings';

describe('EngineType enum', () => {
  it('has Docker value', () => {
    expect(EngineType.Docker).toBe('docker');
  });

  it('has Podman value', () => {
    expect(EngineType.Podman).toBe('podman');
  });

  it('has TinyRange value', () => {
    expect(EngineType.TinyRange).toBe('tinyrange');
  });
});

describe('CvmfsMode enum', () => {
  it('Stream maps to "false"', () => {
    expect(CvmfsMode.Stream).toBe('false');
  });

  it('Download maps to "true"', () => {
    expect(CvmfsMode.Download).toBe('true');
  });
});

describe('StartupMode enum', () => {
  it('has WelcomePage mode', () => {
    expect(StartupMode.WelcomePage).toBe('welcome-page');
  });

  it('has NewLocalSession mode', () => {
    expect(StartupMode.NewLocalSession).toBe('new-local-session');
  });

  it('has LastSessions mode', () => {
    expect(StartupMode.LastSessions).toBe('restore-sessions');
  });
});

describe('ThemeType enum', () => {
  it('has System, Light, and Dark', () => {
    expect(ThemeType.System).toBe('system');
    expect(ThemeType.Light).toBe('light');
    expect(ThemeType.Dark).toBe('dark');
  });
});
