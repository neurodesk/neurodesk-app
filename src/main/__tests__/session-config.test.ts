import { SessionConfig } from '../config/sessionconfig';

describe('SessionConfig', () => {
  describe('createLocal', () => {
    it('creates with default values', () => {
      const config = SessionConfig.createLocal();
      expect(config.containerConfigName).toBe('');
      expect(config.imageVersion).toBe('');
      expect(config.isRemote).toBe(false);
    });

    it('stores containerConfigName', () => {
      const config = SessionConfig.createLocal(
        undefined,
        undefined,
        'neuroimaging'
      );
      expect(config.containerConfigName).toBe('neuroimaging');
    });

    it('stores imageVersion', () => {
      const config = SessionConfig.createLocal(
        undefined,
        undefined,
        'neuroimaging',
        '2026-07-11'
      );
      expect(config.imageVersion).toBe('2026-07-11');
    });

    it('defaults imageVersion to empty string when not provided', () => {
      const config = SessionConfig.createLocal(
        undefined,
        undefined,
        'neuroimaging'
      );
      expect(config.imageVersion).toBe('');
    });
  });

  describe('serialize / deserialize imageVersion', () => {
    it('serializes imageVersion when set', () => {
      const config = SessionConfig.createLocal(
        undefined,
        undefined,
        'neuroimaging',
        '2026-06-04'
      );
      const json = config.serialize();
      expect(json.imageVersion).toBe('2026-06-04');
    });

    it('omits imageVersion from serialized output when empty', () => {
      const config = SessionConfig.createLocal(
        undefined,
        undefined,
        'neuroimaging'
      );
      const json = config.serialize();
      expect(json.imageVersion).toBeUndefined();
    });

    it('deserializes imageVersion', () => {
      const config = new SessionConfig();
      config.deserialize({ imageVersion: '2025-12-01' });
      expect(config.imageVersion).toBe('2025-12-01');
    });

    it('preserves imageVersion through serialize/deserialize round-trip', () => {
      const original = SessionConfig.createLocal(
        undefined,
        undefined,
        'neuroimaging',
        '2026-07-11'
      );
      const json = original.serialize();

      const restored = new SessionConfig();
      restored.deserialize(json);
      expect(restored.imageVersion).toBe('2026-07-11');
    });

    it('handles missing imageVersion in deserialized data', () => {
      const config = new SessionConfig();
      config.deserialize({ x: 100, y: 200 });
      expect(config.imageVersion).toBe('');
    });
  });
});
