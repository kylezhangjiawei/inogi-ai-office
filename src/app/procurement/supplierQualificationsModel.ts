import type { SupplyQualification } from '../lib/supplierQualificationsApi';
export const SUPPLY_QUALIFICATION_LABELS: Record<string, string> = { pending: '待审核', approved: '可供货', suspended: '已暂停', withdrawn: '已撤销', scheduled: '尚未生效', expired: '资格已到期', material_unapproved: '物料审核待确认', supplier_disabled: '供应商已停用' };
export function filterSupplyQualifications(rows: SupplyQualification[], query: string, status: string) {
  const needle = query.trim().toLocaleLowerCase();
  return rows.filter(row => (!status || row.effectiveStatus === status) && (!needle || [row.materialName, row.materialCode, row.supplierName, ...row.products.map(product => product.name)].join(' ').toLocaleLowerCase().includes(needle)));
}
