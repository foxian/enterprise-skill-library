// Tenant Organization 生命周期状态的统一文案与标签配色,
// 供 Web Console 各视图复用,保证状态展示一致。

const ORG_STATUS_KEYS: Record<string, string> = {
  pending: 'status.pending',
  active: 'status.active',
  failed: 'status.failed',
  rejected: 'status.rejected',
  cancelled: 'status.cancelled',
  expired: 'status.expired',
  deleting: 'status.deleting',
  delete_failed: 'status.deleteFailed',
  deleted: 'status.deleted'
};

export function orgStatusText(status?: string | null): string {
  if (!status) return 'status.notManaged';
  return ORG_STATUS_KEYS[status] ?? status;
}

export function orgStatusTagType(status?: string | null): 'success' | 'warning' | 'danger' | 'info' {
  const mapping: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
    active: 'success',
    pending: 'warning',
    deleting: 'warning',
    failed: 'danger',
    delete_failed: 'danger'
  };
  if (!status) return 'info';
  return mapping[status] ?? 'info';
}
