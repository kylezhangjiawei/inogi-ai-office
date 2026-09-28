import type { BomNode } from "../lib/procurementApi";

export function isBomMaterial(node: BomNode): boolean {
  return !node.children.length && Boolean(node.material || node.code?.trim() || node.qtyPer !== null);
}

export function flattenBom(nodes: BomNode[]): BomNode[] {
  return nodes.flatMap((node) => [node, ...flattenBom(node.children)]);
}

export function bomDevices(roots: BomNode[]) {
  const all = flattenBom(roots);
  return [...new Set(all.map((node) => node.productLine).filter(Boolean))].map((productLine) => {
    const nodes = all.filter((node) => node.productLine === productLine);
    const rootNodes = nodes.filter((node) => !node.parentId || !nodes.some((parent) => parent.id === node.parentId));
    const root = rootNodes.length === 1 && !isBomMaterial(rootNodes[0]) ? rootNodes[0] : null;
    const materials = nodes.filter(isBomMaterial);
    const incomplete = materials.filter((node) => !node.material || !node.code || !node.qtyPer || node.qtyPer <= 0).length;
    return { productLine, name: root?.name || productLine, root, roots: rootNodes, nodes, materials, incomplete };
  }).sort((a, b) => (a.root?.sortOrder ?? 0) - (b.root?.sortOrder ?? 0) || a.productLine.localeCompare(b.productLine, "zh-CN", { numeric: true }));
}
