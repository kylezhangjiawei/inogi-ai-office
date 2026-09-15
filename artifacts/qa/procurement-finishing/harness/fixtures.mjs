export function createOrder() {
  const base = { unit: '件', qty: 300, receivedQty: 60, sourceUpdatedAt: '2026-09-10T08:00:00.000Z' };
  const confirmation = { availableDate: '2026-09-26', note: '第 12 次核对说明（隔离验证）', confirmedByName: '另一位经办人（隔离验证）', confirmedAt: '2026-09-12T02:30:00.000Z', version: 12, needsReconfirmation: false };
  return {
    id: 'QA-PO-20260910', poNo: 'QA-PO-20260910', supplier: '演示供应商 · 不关联实际业务', buyer: '日期确认演示员', owner: '隔离测试采购部',
    status: '部分到货', orderDate: '2026-09-09', etaDate: '2026-09-13', itemCount: 3, amount: 59400, currency: 'CNY', warehouse: '量产仓（演示）',
    sourceFile: '本地内存演示数据', syncedAt: base.sourceUpdatedAt, approvalStatus: '已审批（演示）', paymentTerm: '月结（演示）',
    supplierContact: '演示联系人', supplierPhone: '', supplierEmail: '', remark: '此订单仅存在于本地测试进程内存，不会访问或写入实际系统。',
    items: [
      { ...base, id: 'qa-date-line-1', lineNo: '1', sku: 'QA/VALVE-01', name: '阀体（未确认）', spec: 'M8 标准阀体', unitPrice: 40, etaDate: '2026-09-13', availability: null },
      { ...base, id: 'qa-date-line-2', lineNo: '2', sku: 'QA-COMP-02', name: '压缩机（已确认）', spec: 'DC 24V 双缸压缩机', unitPrice: 130, etaDate: '2026-09-13', availability: { ...confirmation } },
      { ...base, id: 'qa-date-line-3', lineNo: '3', sku: 'QA-FILTER-03', name: '筛筒（来源已变）', spec: '不锈钢筛筒 · 加长规格说明用于窄屏验证', unitPrice: 28, etaDate: '2026-09-16', availability: { ...confirmation, note: '原按 9 月 13 日到货确认；订单已改期，请重新核对。', needsReconfirmation: true } },
    ], taskLinks: [],
  };
}

export function createLinkedOrder() {
  const order = createOrder();
  for (let i = 0; i < 10; i++) order.items.push({ ...order.items[0], id: `qa-extra-${i}`, lineNo: String(i + 4), availability: i === 0 ? {...order.items[1].availability} : i === 1 ? {...order.items[2].availability} : null });
  order.itemCount = order.items.length;
  order.amount = order.items.reduce((sum,line) => sum + line.qty * line.unitPrice, 0);
  return order;
}
export function createReadiness(productLine = 'Q5', targetSets = 300) {
  const templates = createOrder().items;
  const items = templates.map((line, index) => ({
    id: `qa-bom-${index+1}`, code: line.sku, name: line.name, category: '装配组件', bomPosition: '整机装配', spec: line.spec, unit: '件', qtyPer: 1,
    stock: 120, available: 120, inTransit: 60, safeStock: 0, currentSets: 120, withTransitSets: 180, targetDemand: targetSets,
    gapAfterTransit: Math.max(0,targetSets-180), status: targetSets > 180 ? 'gap' : 'ready', issue: null,
    syncedAt: '2026-09-10T08:00:00.000Z', sourceLines: [],
  }));
  return { source:'tplus',readOnly:true,productLine,models:[{id:'Q5',label:'Q5',bomLines:3}],
    warehouse:{keyword:'量产',label:'量产仓库',matchedNames:['隔离量产仓']},syncedAt:'2026-09-10T08:00:00.000Z',
    summary:{targetSets,currentBuildableSets:120,withTransitBuildableSets:180,inTransitGainSets:60,targetGapAfterTransit:Math.max(0,targetSets-180),warningMaterials:targetSets>180?3:0,bottleneckMaterials:3,inTransitMaterials:3},
    dataQuality:{totalBomLines:3,usableBomLines:3,invalidBomLines:0,inventoryMatchedLines:3,bomCompleteness:1,inventoryMatchRate:1,provisional:false},items };
}

export function createPlans(order) {
 const base={planType:'material',productId:'qa-product',treeNodeId:'qa-module',materialName:'阀体 · 日期核对演示',materialId:'qa-material',spec:'M8',unit:'件',targetQty:300,purchasedQty:300,receivedQty:60,qualifiedQty:40,inTransitQty:240,arrivalProgress:20,qualificationProgress:13,readinessStatus:'partial_received',tasks:[{id:'qa-task-1',code:'PR-QA-01',materialName:'阀体',quantity:300,status:'in_transit',needDate:'2026-09-16'}],remainingQty:0,progress:100,status:'completed',targetDate:'2026-09-16',createdByName:'演示采购员',createdAt:'2026-09-10T00:00:00Z',updatedAt:'2026-09-10T00:00:00Z',note:'内存演示计划，不访问实际业务数据',batches:[{id:'qa-batch-1',supplierName:order.supplier,purchaseOrderMirrorId:order.items[0].id,purchaseOrderNo:order.poNo,purchaseQty:300,receivedQty:60,qualifiedQty:40,inTransitQty:240,orderDate:'2026-09-09',expectedArrivalDate:'2026-09-13',createdByName:'演示采购员',createdAt:'2026-09-10T00:00:00Z',updatedAt:'2026-09-10T00:00:00Z'}]};
 return [{...base,id:'qa-plan-1',code:'SP-QA-001'},{...base,id:'qa-plan-2',code:'SP-QA-002',materialName:'无目标日期演示',targetDate:undefined,batches:[],purchasedQty:0,receivedQty:0,qualifiedQty:0,inTransitQty:0,arrivalProgress:0,qualificationProgress:0,readinessStatus:'not_received',remainingQty:300,progress:0,status:'not_started'},{...base,id:'qa-plan-3',code:'SP-QA-003',materialName:'无关联订单演示',batches:[],tasks:[],purchasedQty:0,receivedQty:0,qualifiedQty:0,inTransitQty:0,arrivalProgress:0,qualificationProgress:0,readinessStatus:'not_received',remainingQty:300,progress:0,status:'not_started'}];
}
export function createDateCheck(plan,order,page=1){
 const source={kind:'task',id:'qa-task-1',label:'任务 PR-QA-01'};
 const lines=plan.id==='qa-plan-3'?[]:order.items.map((line,index)=>({kind:'line',key:'line:'+line.id,lineId:line.id,orderNo:order.poNo,lineNo:line.lineNo,inventoryCode:line.sku,inventoryName:line.name,unit:line.unit,supplierName:order.supplier,etaDate:line.etaDate,syncedAt:order.syncedAt,orderStatus:'已审批（演示）',approvalStatus:order.approvalStatus,availability:line.availability,
 dateCheck:line.availability?.needsReconfirmation?'needs_reconfirmation':!line.availability?'unconfirmed':!line.availability.availableDate?'cleared':!plan.targetDate?'target_missing':line.availability.availableDate>plan.targetDate?'after_target':'on_or_before_target',sources:index===0?[{kind:'batch',id:'qa-batch-1',label:'第1批'},source]:[source]}));
 if(plan.id==='qa-plan-1')lines.unshift({kind:'unresolved',key:'unresolved:qa-ref-1',orderNo:'QA-OLD-001',lineNo:null,reason:'关联记录缺少订单行号，不能确定对应订单行。',sources:[{kind:'task',id:'qa-task-2',label:'任务 PR-QA-02'}]});
 const totalPages=Math.max(1,Math.ceil(lines.length/10));const actual=Math.min(totalPages,Math.max(1,page));
 return {readOnly:true,plan:{id:plan.id,code:plan.code,targetDate:plan.targetDate||null,updatedAt:plan.updatedAt},rows:{items:lines.slice((actual-1)*10,actual*10),page:actual,pageSize:10,total:lines.length,totalPages}};
}
