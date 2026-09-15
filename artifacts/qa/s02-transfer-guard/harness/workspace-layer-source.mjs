import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';

export const workspaceLayerVirtualId = 'virtual:s02-workspace-modal-layer';
export const workspaceLayerResolvedId = '\0' + workspaceLayerVirtualId;

/** Extract the actual contiguous source; never duplicate or rewrite the layer algorithm. */
export function extractWorkspaceModalLayer(project) {
  const filename = `${project}/src/app/RDMyWorkspacePage.tsx`;
  const fullSource = readFileSync(filename, 'utf8');
  const tree = ts.createSourceFile(filename, fullSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const first = tree.statements.find((node) => ts.isVariableStatement(node)
    && node.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'WORKSPACE_MODAL_FOCUSABLE_SELECTOR'));
  const last = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'useWorkspaceModalLayer');
  if (!first || !last || first.getStart(tree) >= last.end) throw new Error('Workspace modal source boundaries changed; fixture refuses to substitute an algorithm.');
  const source = fullSource.slice(first.getStart(tree), last.end);
  for (const name of ['WORKSPACE_NESTED_PORTAL_SELECTOR', 'focusBelongsToNestedWorkspacePortal', 'hasExternalModalDialog', 'workspaceModalLayers']) {
    if (!source.includes(name)) throw new Error(`Workspace modal dependency missing: ${name}`);
  }
  const provenance = {
    path: 'src/app/RDMyWorkspacePage.tsx',
    startLine: tree.getLineAndCharacterOfPosition(first.getStart(tree)).line + 1,
    endLine: tree.getLineAndCharacterOfPosition(last.end).line + 1,
    sha256: createHash('sha256').update(source).digest('hex'),
  };
  const moduleSource = `import React, { useRef } from 'react';\n${source}\nexport { useWorkspaceModalLayer };\nexport const workspaceLayerProvenance = ${JSON.stringify(provenance)};\n`;
  const compiled = ts.transpileModule(moduleSource, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: 'workspace-layer.tsx' });
  return { filename, source, provenance, code: compiled.outputText };
}
