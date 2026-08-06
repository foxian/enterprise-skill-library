export interface ToolAdapter {
  name: string;
  projectDir(root: string): string;
  globalDir(): string;
  adapt(skillSourceDir: string, skillName: string, targetBaseDir: string): Promise<void>;
  clean(targetBaseDir: string): Promise<void>;
}
