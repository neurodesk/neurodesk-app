import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { EngineType } from './settings';
import { validateStorageMount } from './storageMount';

export type PlatformType = 'windows' | 'unix';

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface VariableContext {
  port: string;
  serverPort: string;
  token: string;
  cvmfsDisable: string;
  tinyrangePath: string;
  buildDir?: string;
  storageDir?: string;
  additionalDir?: string;
  volumeMount?: string;
}

/**
 * A run flag that only applies when a host condition holds.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export interface ConditionalRunArg {
  arg: string;
  engines?: string[];
  platforms?: PlatformType[];
  minOsVersion?: number;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface BaseContainerConfig {
  commonLaunchArgs: string[];
  engines: {
    [key: string]: {
      base_cmd: string;
      trailingImage?: boolean;
      volume_mount?: string;
      args?: string[];
    };
  };
  additionalDirConfig?: {
    [engine: string]: {
      [platform: string]: string;
    };
  };
  launchArgs?: {
    [engine: string]: {
      [platform: string]: {
        base_cmd: string;
        volume_mount?: string;
        args: string[];
      };
    };
  };
  conditionalRunArgs?: ConditionalRunArg[];
  tinyrangePrelude?: {
    [platform: string]: string;
  };
  tinyrangeAdditionalDirPrelude?: {
    [platform: string]: string;
  };
  defaultServerArgs?: string[];
  tinyrangePostArgs?: string;
  containerPort?: string;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface ContainerConfig {
  title: string;
  defaultVersion: string;
  registry: string;
  releaseHistoryUrl?: string;
  containerName: string;
  volumeMount: string;
  defaultStorageMount: string;
  description?: string;
  remoteUrl?: string[];
  tags?: string[];
}

/**
 * Options for {@link ContainerConfigParser.buildLaunchArgs}.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export interface BuildLaunchArgsOptions {
  platform?: PlatformType;
  /** Host OS version (Ubuntu YYMM), used to evaluate conditionalRunArgs. */
  osVersion?: string;
  /** Host directory to mount at /data, already resolved. */
  additionalDir?: string;
  /** Append the default server args. False when the user overrides them. */
  includeServerArgs?: boolean;
}

const DEFAULT_CONTAINER_PORT = '8888';

export class ContainerConfigParser {
  private baseContainerConfig: BaseContainerConfig;
  private containerConfig: ContainerConfig;
  private version: string;

  constructor(
    baseContainerConfigPath?: string,
    containerConfigName?: string,
    version?: string
  ) {
    this.baseContainerConfig = this.loadBaseContainerConfig(
      baseContainerConfigPath
    );
    this.containerConfig = this.loadContainerConfig(containerConfigName);
    this.containerConfig.defaultStorageMount = validateStorageMount(
      this.containerConfig.defaultStorageMount
    );
    this.version = version || this.containerConfig.defaultVersion;
  }

  private loadBaseContainerConfig(configPath?: string): BaseContainerConfig {
    if (!fs.existsSync(configPath)) {
      throw new Error(`Neurodesk config file not found at ${configPath}`);
    }

    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      const config = yaml.load(configContent) as BaseContainerConfig;
      return config;
    } catch (error) {
      throw new Error(`Failed to parse neurodesk.yml: ${error}`);
    }
  }

  private loadContainerConfig(containerConfigName?: string): ContainerConfig {
    if (!fs.existsSync(containerConfigName)) {
      throw new Error(
        `ContainerConfig file not found at ${containerConfigName}`
      );
    }

    try {
      const configContent = fs.readFileSync(containerConfigName, 'utf8');
      const config = yaml.load(configContent) as ContainerConfig;
      return config;
    } catch (error) {
      throw new Error(`Failed to parse containerConfig.yml: ${error}`);
    }
  }

  /**
   * Get the platform type based on the current operating system
   */
  private getPlatform(): PlatformType {
    return process.platform === 'win32' ? 'windows' : 'unix';
  }

  /**
   * Substitute variables in a string with actual values
   */
  private substituteVariables(text: string, context: VariableContext): string {
    let result = text;

    // Replace all placeholders with actual values
    const substitutions: { [key: string]: string } = {
      '{port}': context.port,
      '{containerPort}': this.getContainerPort(),
      '{serverPort}': context.serverPort,
      '{token}': context.token,
      '{tag}': this.version,
      '{cvmfsDisable}': context.cvmfsDisable,
      '{tinyrangePath}': context.tinyrangePath,
      '{buildDir}': context.buildDir || '',
      '{storageDir}': context.storageDir || '',
      '{storageMount}': this.getDefaultStorageMount(),
      '{additionalDir}': context.additionalDir || '',
      '{imageRegistry}': this.getImageName(),
      '{volume_mount}': context.volumeMount || '',
      '{containerName}': this.containerConfig.containerName || ''
    };

    for (const [placeholder, value] of Object.entries(substitutions)) {
      result = result.replace(
        new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'),
        value
      );
    }

    return result;
  }

  /**
   * Substitute variables in an array of strings
   */
  private substituteVariablesInArray(
    args: string[],
    context: VariableContext
  ): string[] {
    return args.map(arg => this.substituteVariables(arg, context));
  }

  /**
   * Flatten nested template strings like {commonLaunchArgs}
   */
  private expandTemplateArgs(
    args: string[],
    context: VariableContext,
    engine: EngineType
  ): string[] {
    const expanded: string[] = [];

    for (const arg of args) {
      if (arg === '{commonLaunchArgs}') {
        // Expand common launch args
        const commonArgs = this.substituteVariablesInArray(
          this.baseContainerConfig.commonLaunchArgs,
          context
        );
        expanded.push(...commonArgs);
      } else if (arg === '{base_cmd}') {
        // Get base command for the engine
        const engineConfig = this.baseContainerConfig.engines[engine];
        if (engineConfig?.base_cmd) {
          expanded.push(
            this.substituteVariables(engineConfig.base_cmd, context)
          );
        }
      } else {
        expanded.push(this.substituteVariables(arg, context));
      }
    }

    return expanded;
  }

  /**
   * Parse the run flags for a specific engine and platform.
   *
   * The result never contains the image reference — Docker and Podman treat
   * everything after it as the container command, so it is appended last by
   * {@link buildLaunchArgs}. Prefer buildLaunchArgs over calling this directly.
   */
  public parseArgs(
    engine: EngineType,
    context: VariableContext,
    platform?: PlatformType
  ): string[] {
    const platformType = platform || this.getPlatform();

    // First, try to get from launchArgs matrix
    if (this.baseContainerConfig.launchArgs?.[engine]?.[platformType]) {
      const launchConfig = this.baseContainerConfig.launchArgs[engine][
        platformType
      ];

      // Update context with engine-specific volume mount
      if (launchConfig.volume_mount) {
        context.volumeMount = launchConfig.volume_mount;
      }

      // Expand and substitute args
      const expandedArgs = this.expandTemplateArgs(
        launchConfig.args,
        context,
        engine
      );
      return expandedArgs;
    }

    // Fallback to engine base configuration
    const engineConfig = this.baseContainerConfig.engines[engine];
    if (!engineConfig) {
      throw new Error(`Engine '${engine}' not found in configuration`);
    }

    // Build args from base configuration
    const args: string[] = [];

    // Add base command
    if (engineConfig.base_cmd) {
      args.push(this.substituteVariables(engineConfig.base_cmd, context));
    }

    // Add common launch args
    const commonArgs = this.substituteVariablesInArray(
      this.baseContainerConfig.commonLaunchArgs,
      context
    );
    args.push(...commonArgs);

    // Add engine-specific args if available
    if (engineConfig.args) {
      const engineArgs = this.substituteVariablesInArray(
        engineConfig.args,
        context
      );
      args.push(...engineArgs);
    }

    // Add volume mount if specified
    if (engineConfig.volume_mount) {
      const volumeArg = this.substituteVariables(
        `-v ${engineConfig.volume_mount}`,
        context
      );
      args.push(volumeArg);
    }

    return args;
  }

  /**
   * Assemble the complete launch argument list for an engine.
   *
   * This is the only supported way to build a launch command. It owns the
   * ordering the engines require: every run flag (including the conditional
   * ones and the /data mount) first, then the image reference, then the
   * container command.
   */
  public buildLaunchArgs(
    engine: EngineType,
    context: VariableContext,
    options: BuildLaunchArgsOptions = {}
  ): string[] {
    const platformType = options.platform || this.getPlatform();
    const isTinyRange = engine === EngineType.TinyRange;
    const includeServerArgs = options.includeServerArgs !== false;

    const args = this.parseArgs(engine, context, platformType);

    args.push(
      ...this.getConditionalRunArgs(engine, platformType, options.osVersion)
    );

    if (options.additionalDir) {
      const additionalDirConfig = this.getAdditionalDirConfig(
        engine,
        options.additionalDir,
        platformType
      );
      if (additionalDirConfig) {
        args.push(additionalDirConfig);
      }
    }

    // Docker and Podman take the image as a positional argument after the run
    // flags; TinyRange has already passed it inline as --oci.
    if (this.usesTrailingImage(engine)) {
      args.push(this.getImageName());
    }

    if (includeServerArgs) {
      // The TinyRange prelude opens the -E quote that tinyrangePostArgs
      // closes, so it only makes sense alongside the server args.
      if (isTinyRange) {
        const prelude = this.getTinyrangePrelude(
          context,
          platformType,
          options.additionalDir
        );
        if (prelude) {
          args.push(prelude);
        }
      }

      args.push(...this.getDefaultServerArgs(context));

      if (isTinyRange) {
        const postArgs = this.getTinyrangePostArgs();
        if (postArgs) {
          args.push(postArgs);
        }
      }
    }

    return args;
  }

  /**
   * Whether the engine expects the image reference after its run flags.
   */
  public usesTrailingImage(engine: EngineType): boolean {
    return this.baseContainerConfig.engines[engine]?.trailingImage === true;
  }

  /**
   * Run flags whose host condition holds for this engine/platform/OS version.
   */
  public getConditionalRunArgs(
    engine: EngineType,
    platform?: PlatformType,
    osVersion?: string
  ): string[] {
    const platformType = platform || this.getPlatform();
    const parsedOsVersion = parseInt(osVersion, 10);

    return (this.baseContainerConfig.conditionalRunArgs || [])
      .filter(entry => {
        if (entry.engines && !entry.engines.includes(engine)) {
          return false;
        }
        if (entry.platforms && !entry.platforms.includes(platformType)) {
          return false;
        }
        if (entry.minOsVersion !== undefined) {
          // An unknown host OS version never satisfies a version floor.
          if (isNaN(parsedOsVersion) || parsedOsVersion < entry.minOsVersion) {
            return false;
          }
        }
        return true;
      })
      .map(entry => entry.arg);
  }

  /**
   * Get additional directory configuration for an engine and platform
   */
  public getAdditionalDirConfig(
    engine: EngineType,
    additionalDir: string,
    platform?: PlatformType
  ): string | null {
    const platformType = platform || this.getPlatform();

    if (
      !this.baseContainerConfig.additionalDirConfig?.[engine]?.[platformType]
    ) {
      return null;
    }

    const template = this.baseContainerConfig.additionalDirConfig[engine][
      platformType
    ];
    return this.substituteVariables(template, {
      additionalDir:
        platformType === 'windows'
          ? additionalDir.replace(/\\/g, '/')
          : additionalDir
    } as VariableContext);
  }

  /**
   * Get default server arguments
   */
  public getDefaultServerArgs(context: VariableContext): string[] {
    if (!this.baseContainerConfig.defaultServerArgs) {
      return [];
    }

    return this.substituteVariablesInArray(
      this.baseContainerConfig.defaultServerArgs,
      context
    );
  }

  /**
   * Get the image registry from config
   */
  public getImageRegistry(): string {
    return this.containerConfig.registry;
  }

  /**
   * Get the image version in use — the override when one was supplied,
   * otherwise the config's defaultVersion.
   */
  public getImageVersion(): string {
    return this.version;
  }

  /**
   * Override the image version (e.g. a version picked in the UI). Applies to
   * every subsequent substitution of {tag} and {imageRegistry}.
   */
  public setImageVersion(version?: string): void {
    this.version = version || this.containerConfig.defaultVersion;
  }

  /**
   * Get the version declared in the config, ignoring any override.
   */
  public getDefaultImageVersion(): string {
    return this.containerConfig.defaultVersion;
  }

  /**
   * Fully qualified image reference (registry:version).
   */
  public getImageName(): string {
    return `${this.containerConfig.registry}:${this.version}`;
  }

  /**
   * Get the container name from config
   */
  public getContainerName(): string {
    return this.containerConfig.containerName;
  }

  /**
   * Port JupyterLab listens on inside the container.
   */
  public getContainerPort(): string {
    return this.baseContainerConfig.containerPort || DEFAULT_CONTAINER_PORT;
  }

  /**
   * Get TinyRange -E prelude for a given platform. When an additional
   * directory is mounted, the /data ownership fixup is appended to it.
   */
  public getTinyrangePrelude(
    context: VariableContext,
    platform?: PlatformType,
    additionalDir?: string
  ): string | null {
    const platformType = platform || this.getPlatform();
    if (!this.baseContainerConfig.tinyrangePrelude?.[platformType]) {
      return null;
    }
    let prelude = this.baseContainerConfig.tinyrangePrelude[platformType];
    const additionalDirPrelude = this.baseContainerConfig
      .tinyrangeAdditionalDirPrelude?.[platformType];
    if (additionalDir && additionalDirPrelude) {
      prelude += additionalDirPrelude;
    }
    return this.substituteVariables(prelude, context);
  }

  /**
   * Get TinyRange post-args (e.g. --FileContentsManager.delete_to_trash=False")
   */
  public getTinyrangePostArgs(): string | null {
    return this.baseContainerConfig.tinyrangePostArgs || null;
  }

  /**
   * Get the volume mount for the image
   */
  public getVolumeMount(): string | undefined {
    return this.containerConfig.volumeMount;
  }

  public getDefaultStorageMount(): string {
    return this.containerConfig.defaultStorageMount;
  }
}
