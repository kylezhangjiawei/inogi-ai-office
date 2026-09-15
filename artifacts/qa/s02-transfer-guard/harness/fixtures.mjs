export const stamp = '2026-09-14T05:00:00.000Z';
export const user = {
  id: 'qa-s02-rd-owner', name: '隔离研发工程师', role: 'research', roleId: 'qa-rd-role',
  department: '隔离研发部', departmentCode: 'qa-rd', email: 's02@example.invalid',
  permissions: ['proc-task:transfer', 'page:rd-my-workspace', 'page:rd-task-detail', 'page:proc-cockpit'],
};
export const products = [
  { id: 'qa-s02-product-a', name: '隔离测试产品甲', status: 'active', createdAt: stamp, updatedAt: stamp },
  { id: 'qa-s02-product-b', name: '隔离测试产品乙', status: 'developing', createdAt: stamp, updatedAt: stamp },
];
// Small original QA PDF; generated locally, not copied from a business document.
export function drawingPdf() {
  const stream = 'BT /F1 16 Tf 40 170 Td (S02 LOCAL TEST DRAWING) Tj ET\n40 50 220 85 re S\nBT /F1 10 Tf 40 30 Td (Synthetic dimensions - no business data) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 210] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}
export const notesText = 'S02 本地测试说明\n这份资料完全由隔离夹具生成，不来自真实研发任务。\n用于核对附件选择、上传锁与转采购表单。\n';
export const attachments = [
  { id: 'qa-s02-attachment-drawing', name: '阀体结构图-QA.pdf', size: drawingPdf().length, mimeType: 'application/pdf', fileUrl: '/__qa/files/drawing.pdf', fileKey: 'qa-s02/original/drawing.pdf' },
  { id: 'qa-s02-attachment-notes', name: '测试说明-QA.txt', size: new TextEncoder().encode(notesText).length, mimeType: 'text/plain', fileUrl: '/__qa/files/notes.txt', fileKey: 'qa-s02/original/notes.txt' },
];
export const initialTasks = {
  fresh: { taskId: 'qa-s02-rd-new', taskTitle: '阀体组件选型', productId: products[0].id, owner: user.name, ownerUserId: user.id, priority: 'medium', dueDate: '2026-09-28', attachments },
  resubmit: { taskId: 'qa-s02-rd-resubmit', taskTitle: '支架加工复核', productId: products[0].id, owner: user.name, ownerUserId: user.id, priority: 'high', dueDate: '2026-09-29', attachments },
};
export function makeProcTask(input, count = 1) {
  const previous = input.rdTaskId === initialTasks.resubmit.taskId;
  return {
    id: previous ? 'qa-s02-existing-proc-task' : `qa-s02-generated-${count}`,
    code: previous ? 'CG-S02-QA-EXISTING' : `CG-S02-QA-${String(count).padStart(3, '0')}`,
    productId: input.productId || products[0].id, materialId: null, treeNodeId: null,
    materialName: input.materialName || '隔离物料', spec: input.spec || '', unit: input.unit || '件', quantity: input.quantity || 1,
    method: input.method || 'inquiry', purchaseLink: input.purchaseLink || '', needDate: input.needDate,
    deadline: input.deadline, paymentStatus: 'unpaid', arrivedQty: 0, source: 'rd', businessLine: 'rd',
    rdTaskId: input.rdTaskId, rdTaskTitle: input.rdTaskTitle, rdContact: input.rdContact || user.name,
    rdContactUserId: input.rdContactUserId, buyer: '隔离采购员（未通知）', buyerUserId: 'qa-s02-buyer',
    requester: user.name, requesterDept: input.requesterDept || user.department, priority: input.priority || 'medium',
    needSample: false, attachments: input.attachments?.length || 0,
    attachmentList: (input.attachments || []).map((file, index) => ({ ...file, id: `qa-s02-submitted-${count}-${index}`, kind: file.kind || 'drawing', fileSize: file.fileSize || 0 })),
    purchaseOrders: [], criticalMaterials: [], consumableNote: input.consumableNote || '', businessDone: false,
    status: 'pending_confirm', rdTransferSnapshots: [], logs: [{ at: stamp, text: '隔离内存模拟提交成功；未落库、未通知任何业务人员。' }],
    createdAt: stamp, updatedAt: stamp, alreadyTransferred: false,
  };
}
export const resubmitFrom = {
  ...makeProcTask({ ...initialTasks.resubmit, rdTaskId: initialTasks.resubmit.taskId, rdTaskTitle: initialTasks.resubmit.taskTitle,
    productId: products[1].id, materialName: '上次填写的精密支架', spec: 'M8 · 304 不锈钢', unit: '套', quantity: 12,
    purchaseLink: 'https://example.invalid/qa-only', method: 'direct', needDate: '2026-09-25', deadline: '2026-09-22',
    rdContact: user.name, rdContactUserId: user.id, consumableNote: '上次需求备注：保留规格与数量，重新选择本次附件。' }),
  status: 'cancelled', cancelReason: '隔离历史需求退回，等待重新提交',
};
