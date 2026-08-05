import { pathToFileURL } from 'node:url';
import { initDatabase, SkillRepository } from './db/database.js';

const sampleSkill = {
  name: '@myorg/my-skill',
  scope: 'myorg',
  skillName: 'my-skill',
  description: 'Sample seeded skill',
  createdBy: 'dev',
  owner: 'platform',
  maintainers: ['dev'],
  visibility: 'public',
  gitRepoPath: 'myorg/my-skill'
};

export function seedDevelopmentData(dbPath: string): void {
  const db = initDatabase(dbPath);
  const repo = new SkillRepository(db);
  try {
    if (!repo.getSkill(sampleSkill.name)) {
      repo.createSkill(sampleSkill);
    }
    if (!repo.getVersions(sampleSkill.name).includes('0.1.0')) {
      repo.addVersion(sampleSkill.name, '0.1.0');
    }
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dbPath = process.env.DATABASE_PATH;
  if (!dbPath) {
    console.error('Missing required environment variable: DATABASE_PATH');
    process.exitCode = 1;
  } else {
    seedDevelopmentData(dbPath);
    console.log('Seeded development skill metadata');
  }
}
