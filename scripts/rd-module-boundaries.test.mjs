import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const app = new URL('../src/app/', import.meta.url);
const modules = readdirSync(new URL('rd/', app)).filter((file) => /\.tsx?$/.test(file));
const source = (file) => readFileSync(new URL(file, app), 'utf8');
const parse = (file) => ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true);

test('研发模块不反向依赖页面，也不存在模块之间的循环导入', () => {
  const graph = new Map(modules.map((file) => {
    const dependencies = parse(`rd/${file}`).statements.filter((node) =>
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      .flatMap((node) => node.moduleSpecifier ? [node.moduleSpecifier.text] : []);
    assert.ok(dependencies.every((dep) => !/Page$/.test(dep)), `${file} 不应引用页面`);
    return [file.replace(/\.tsx?$/, ''), dependencies.filter((dep) => dep.startsWith('./')).map((dep) => path.posix.normalize(dep).replace(/\.tsx?$/, ''))];
  }));
  function visit(name, stack = []) {
    assert.ok(!stack.includes(name), `循环依赖：${[...stack, name].join(' → ')}`);
    for (const dependency of graph.get(name) || []) visit(dependency, [...stack, name]);
  }
  for (const name of graph.keys()) visit(name);
});

test('页面提供者和人员卡片使用同一个备注回执 Context，不重复创建', () => {
  const page = source('RDTaskManagementPage.tsx');
  const person = source('rd/PersonTaskCockpit.tsx');
  assert.match(page, /NoteReceiptContext\.Provider/);
  assert.match(person, /useContext\(NoteReceiptContext\)/);
  for (const consumer of [page, person]) {
    assert.match(consumer, /import\s*\{[^}]*NoteReceiptContext[^}]*\}\s*from\s*["'][^"']*cockpitModel["']/);
    assert.doesNotMatch(consumer, /const NoteReceiptContext\s*=/);
  }
  assert.match(source('rd/cockpitModel.ts'), /export const NoteReceiptContext = React\.createContext/);
});
