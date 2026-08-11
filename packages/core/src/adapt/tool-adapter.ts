export interface AdaptedSkill {
  identity: string;
  directoryName: string;
  displayName: string;
}

export interface ToolAdapter {
  name: string;
  projectDir(root: string): string;
  globalDir(homeDir?: string): string;
  adapt(skillSourceDir: string, skill: AdaptedSkill, targetBaseDir: string): Promise<void>;
  clean(targetBaseDir: string): Promise<void>;
}
