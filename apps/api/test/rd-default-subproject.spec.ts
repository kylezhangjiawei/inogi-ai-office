import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RD_DEFAULT_SUBPROJECT_FLAG,
  RD_DEFAULT_SUBPROJECT_ID_SUFFIX,
  RD_DEFAULT_SUBPROJECT_LABEL,
  ensureDefaultSubProject,
} from '../src/modules/research-development/research-development.service';

/**
 * 一级分类的默认子项。
 *
 * 任务在存储上只存在于 `分类 → 子项 → tasks` 的第二级，而「管理分类」能建出 children 为空的
 * 一级分类——那种分类此前既立不了项也移不进任务。补默认子项让两级结构永远成立。
 *
 * 这里钉的三条性质都不是"锦上添花"，任何一条破了都会造成难查的线上问题：
 * - id 不确定 → 每次读出来的树都不同 → 结构版本号一直变 → 用户改什么都提示「请刷新后再修改」
 * - 不幂等 → 整树 PUT 回来后越补越多
 * - 碰了已有子项的分类 → 破坏真实数据
 */

type Cat = Record<string, unknown>;

const child = (id: string, label: string) => ({ id, label, tasks: [] });

test('只给没有子项的分类补，已有子项的一律不碰', () => {
  const input: Cat[] = [
    { id: 'cat-solo', label: '独立系统', children: [] },
    { id: 'cat-power', label: '电源部分', children: [child('sub-1', '电池')] },
  ];

  const out = ensureDefaultSubProject(input);

  const solo = out[0].children as Cat[];
  assert.equal(solo.length, 1);
  assert.equal(solo[0].label, RD_DEFAULT_SUBPROJECT_LABEL);
  assert.equal(solo[0][RD_DEFAULT_SUBPROJECT_FLAG], true);
  assert.equal(solo[0].id, `cat-solo${RD_DEFAULT_SUBPROJECT_ID_SUFFIX}`);

  assert.deepEqual(out[1].children, input[1].children, '已有子项的分类必须原样返回');
});

test('id 由分类 id 确定性派生——随机 id 会让结构版本号每次读都变', () => {
  const input: Cat[] = [{ id: 'cat-solo', label: '独立系统', children: [] }];

  const first = ensureDefaultSubProject(input);
  const second = ensureDefaultSubProject(input);

  assert.equal(
    (first[0].children as Cat[])[0].id,
    (second[0].children as Cat[])[0].id,
    '两次读取必须得到同一个子项 id',
  );
});

test('幂等：补过的树再补一次不会多出子项', () => {
  const input: Cat[] = [{ id: 'cat-solo', label: '独立系统', children: [] }];

  const once = ensureDefaultSubProject(input);
  const twice = ensureDefaultSubProject(once);

  assert.equal((twice[0].children as Cat[]).length, 1, '整树 PUT 回来后不能越补越多');
  assert.deepEqual(twice, once);
});

test('不修改入参（读路径必须保持纯读）', () => {
  const input: Cat[] = [{ id: 'cat-solo', label: '独立系统', children: [] }];
  const snapshot = JSON.stringify(input);

  ensureDefaultSubProject(input);

  assert.equal(JSON.stringify(input), snapshot, '就地改会让调用方在只读路径上写脏数据');
});

test('children 字段缺失或不是数组时同样能补上', () => {
  const out = ensureDefaultSubProject([
    { id: 'cat-a', label: '缺字段' },
    { id: 'cat-b', label: '类型错', children: 'oops' },
  ] as Cat[]);

  for (const cat of out) {
    const children = cat.children as Cat[];
    assert.equal(children.length, 1);
    assert.equal(children[0][RD_DEFAULT_SUBPROJECT_FLAG], true);
  }
});

test('保存与读取必须注入同一次，否则新建一级分类后任何结构修改都会 409', () => {
  // 实测踩到过：saveTaskCategories 按客户端提交的原树落盘并回传版本号，而读路径会补
  // 默认子项——两边算出的结构不同，客户端拿着回传的版本号再提交就被判「系统树已更新」。
  // 这里用「保存后的树再读一次，结构必须不变」来钉住这个不变量。
  const submittedByClient: Cat[] = [
    { id: 'cat-power', label: '电源部分', children: [child('sub-1', '电池')] },
    { id: 'cat-new', label: '新建的一级分类', children: [] },
  ];

  const persisted = ensureDefaultSubProject(submittedByClient);
  const readBack = ensureDefaultSubProject(persisted);

  assert.deepEqual(
    readBack,
    persisted,
    '落盘用的树与随后读出来的树结构必须一致，否则结构版本号对不上',
  );
});

test('分类 id 为空时不抛错，仍给出可用的子项 id', () => {
  const out = ensureDefaultSubProject([{ label: '无 id 分类', children: [] }] as Cat[]);

  const children = out[0].children as Cat[];
  assert.equal(children.length, 1);
  assert.ok(String(children[0].id).endsWith(RD_DEFAULT_SUBPROJECT_ID_SUFFIX));
});
