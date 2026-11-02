import { apiRequest } from '../api/client';

// 外部 Git 引用的客户端模型（ADR-0074）。仅保留界面所需字段，与后端 DTO 解耦。

export type ExternalSyncState = 'idle' | 'syncing' | 'paused' | 'failed';

export interface ExternalSchedule {
  frequency: 'daily' | 'weekly' | 'monthly';
  time: string;
  timeZone: string;
  weekday?: number;
  dayOfMonth?: number;
}

export interface ExternalLicenseInfo {
  basis: string | null;
  provenance: unknown;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

export interface ExternalReferenceView {
  skillName: string;
  repositoryUrl: string;
  skillDirectory: string;
  branch: string;
  schedule: ExternalSchedule;
  syncState: ExternalSyncState;
  visibility: 'private' | 'public';
  locked: boolean;
  lastSyncedCommit: string | null;
  lastSuccessfulAt: string | null;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  currentError: string | null;
  errorCode: string | null;
  license: ExternalLicenseInfo;
  extraFiles: string[];
  catchupDue: boolean;
}

export interface ExternalPreviewResult {
  branch: string;
  commit: string;
  files: string[];
  detectedLicense: string | null;
  licenseProvenance: { path: string; source: string } | null;
}

export interface ExternalSyncResult {
  outcome: 'published' | 'unchanged' | 'failed' | 'license-confirmation-required';
  skillName: string;
  version?: string;
  commit?: string;
  errorCode?: string;
  error?: string;
}

function referencePath(scope: string, skillName: string): string {
  return `/api/external-references/${encodeURIComponent(scope)}/${encodeURIComponent(skillName)}`;
}

// 创建前预览：解析默认分支、抓取内容、检测许可证来源。
export async function previewExternalReference(input: {
  repositoryUrl: string;
  branch?: string;
  skillDirectory?: string;
  extraFiles?: string[];
}): Promise<ExternalPreviewResult> {
  return apiRequest('/api/external-references/preview', { method: 'POST', body: input });
}

export interface CreateExternalReferenceInput {
  scope: string;
  shortName: string;
  repositoryUrl: string;
  branch?: string;
  skillDirectory?: string;
  extraFiles?: string[];
  visibility?: 'private' | 'public';
  schedule?: ExternalSchedule;
}

export async function createExternalReference(
  input: CreateExternalReferenceInput
): Promise<ExternalReferenceView & { initialSync: ExternalSyncResult }> {
  return apiRequest('/api/external-references', { method: 'POST', body: input });
}

export async function getExternalReference(
  scope: string,
  skillName: string
): Promise<ExternalReferenceView> {
  return apiRequest(referencePath(scope, skillName));
}

export interface UpdateExternalReferenceInput {
  branch?: string;
  schedule?: ExternalSchedule;
  visibility?: 'private' | 'public';
  extraFiles?: string[];
}

export async function updateExternalReference(
  scope: string,
  skillName: string,
  input: UpdateExternalReferenceInput
): Promise<ExternalReferenceView> {
  return apiRequest(referencePath(scope, skillName), { method: 'PATCH', body: input });
}

export async function syncExternalReference(
  scope: string,
  skillName: string
): Promise<ExternalSyncResult> {
  return apiRequest(`${referencePath(scope, skillName)}/sync`, { method: 'POST' });
}

export async function pauseExternalReference(
  scope: string,
  skillName: string
): Promise<ExternalReferenceView> {
  return apiRequest(`${referencePath(scope, skillName)}/pause`, { method: 'POST' });
}

export async function resumeExternalReference(
  scope: string,
  skillName: string
): Promise<ExternalReferenceView> {
  return apiRequest(`${referencePath(scope, skillName)}/resume`, { method: 'POST' });
}

export async function confirmExternalLicense(
  scope: string,
  skillName: string,
  input: { basis: string; extraFiles?: string[] }
): Promise<ExternalReferenceView> {
  return apiRequest(`${referencePath(scope, skillName)}/license`, { method: 'POST', body: input });
}
