/**
 * Dictionary that contains all requirement names mapped to version number strings
 */
export interface IVersionContainer {
  [name: string]: string;
}

export interface IDisposable {
  dispose(): Promise<void>;
}

export interface ICLIArguments {
  cwd: string;
  _: (string | number)[];
  // eslint-disable-next-line id-match
  $0: string;
  [x: string]: unknown;
  workingDir: string | unknown;
}

export interface IRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
