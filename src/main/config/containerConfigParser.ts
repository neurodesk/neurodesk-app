import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { EngineType } from './settings';

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

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface BaseContainerConfig {
  commonLaunchArgs: string[];
  engines: {
    [key: string]: {
      base_cmd: string;
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
  tinyrangePrelude?: {
    [platform: string]: string;
  };
  defaultServerArgs?: string[];
  tinyrangePostArgs?: string;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface ContainerConfig {
  title: string;
  defaultVersion: string;
  registry: string;
  releaseHistoryUrl?: string;
  containerName: string;
  volumeMount: string;
  description?: string;
  remoteUrl?: string[];
  tags?: string[];
}

export class ContainerConfigParser {
  private baseContainerConfig: BaseContainerConfig;
  private containerConfig: ContainerConfig;

  constructor(baseContainerConfigPath?: string, containerConfigName?: string) {
    this.baseContainerConfig = this.loadBaseContainerConfig(
      baseContainerConfigPath
    );
    this.containerConfig = this.loadContainerConfig(containerConfigName);
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
      '{serverPort}': context.serverPort,
      '{token}': context.token,
      '{tag}': this.containerConfig.defaultVersion,
      '{cvmfsDisable}': context.cvmfsDisable,
      '{tinyrangePath}': context.tinyrangePath,
      '{buildDir}': context.buildDir || '',
      '{storageDir}': context.storageDir || '',
      '{additionalDir}': context.additionalDir || '',
      '{imageRegistry}':
        this.containerConfig.registry + ':' + this.containerConfig.defaultVersion,
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
   * Parse launch arguments for a specific engine and platform
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

    // Add image registry
    args.push(
      this.containerConfig.registry + ':' + this.containerConfig.defaultVersion
    );

    return args;
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
   * Get the image version from config
   */
  public getImageVersion(): string {
    return this.containerConfig.defaultVersion;
  }

  /**
   * Get the container name from config
   */
  public getContainerName(): string {
    return this.containerConfig.containerName;
  }

  /**
   * Get TinyRange -E prelude for a given platform
   */
  public getTinyrangePrelude(
    context: VariableContext,
    platform?: PlatformType
  ): string | null {
    const platformType = platform || this.getPlatform();
    if (!this.baseContainerConfig.tinyrangePrelude?.[platformType]) {
      return null;
    }
    return this.substituteVariables(
      this.baseContainerConfig.tinyrangePrelude[platformType],
      context
    );
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
}
