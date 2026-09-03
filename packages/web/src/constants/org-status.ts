// Tenant Organization 生命周期状态的统一文案与标签配色,
// 供 Web Console 各视图复用,保证状态展示一致。

export const ORG_STATUS_TEXT: Record<string, string> = {
  pending: '待审批',
  provisioning: '开通中',
  active: '已激活',
  failed: '开通失败',
  rejected: '已拒绝',
  cancelled: '已取消',
  expired: '已过期',
  deleting: '删除中',
  delete_failed: '删除失败',
  deleted: '已删除'
};

export function orgStatusText(status?: string | null): string {
  if (!status) return '未纳管';
  return ORG_STATUS_TEXT[status] ?? status;
}

export function orgStatusTagType(status?: string | null): 'success' | 'warning' | 'danger' | 'info' {
  const mapping: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
    active: 'success',
    pending: 'warning',
    provisioning: 'warning',
    deleting: 'warning',
    failed: 'danger',
    delete_failed: 'danger'
  };
  if (!status) return 'info';
  return mapping[status] ?? 'info';
}
