const log = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  silly: jest.fn(),
  transports: {
    file: { level: 'info' },
    console: { level: 'info' }
  }
};

export default log;
