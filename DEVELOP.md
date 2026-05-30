# 开发与发布指南（DEVELOP）

> 面向开发者：在哪拿代码、怎么改、怎么上线。服务器运维见 [`deploy/RUNBOOK.md`](deploy/RUNBOOK.md)。

## 代码仓库在哪

**权威仓库 = 阿里云服务器上的裸仓库**：

```
root@39.102.98.21:/opt/git/inogi-ai-office.git
```

所有电脑都从这里 `clone`、往这里 `push`。**推送到 `main` 分支 = 自动部署上线**（服务器钩子会自动构建、迁移数据库、重启、发布前端）。

> 注：旧的 Gitee / GitHub 仓库已废弃（历史与线上分叉），不要再用。

## 新电脑首次设置（一次性）

```bash
# 1)（推荐）配 SSH 免密，以后 push 不用输密码
ls ~/.ssh/id_ed25519.pub 2>/dev/null || ssh-keygen -t ed25519 -C "inogi"
ssh-copy-id root@39.102.98.21          # 输一次服务器密码

# 2) 克隆项目
cd ~/work
git clone root@39.102.98.21:/opt/git/inogi-ai-office.git
cd inogi-ai-office
```

只编辑+推送的话，到这就够了，**不需要本地装依赖或配 .env**（服务器负责构建）。

如要**本地运行/调试**，再额外：

```bash
npm install -g corepack && corepack enable   # 启用 pnpm
pnpm install
cp apps/api/.env.example apps/api/.env        # 填本地/测试数据库等（别用生产库）
npm run dev                                    # 前后端一起起
```

## 日常开发流程（每次都这样）

```bash
git pull                       # ① 先拉最新（多台电脑必做，防冲突）
# ② 改代码……
git add -A
git commit -m "改了什么"
git push origin main           # ③ 推送 → 自动部署，终端实时显示部署日志
```

看到日志结尾 `✅ 部署完成` + `[hook] ✅ 部署结束` 就上线了。用户开着的旧页面会自动弹「发现新版本，点击刷新」。

## 注意事项 ⚠️

1. **推 `main` = 直接上线生产**。没把握的改动先开分支，验证后再合并：
   ```bash
   git checkout -b feature-x      # 推分支不会触发部署
   git push origin feature-x
   # 确认 OK 后：
   git checkout main && git merge feature-x && git push origin main
   ```
2. **多台电脑：动手前先 `git pull`**，否则 push 会被拒（要先合并）。
3. `.env` 和 `node_modules` 不在 git 里，新电脑要本地运行才需要单独准备。
4. **改了数据库结构**：在 `apps/api/prisma/schema.prisma` 改完后，本地生成迁移
   `cd apps/api && npx prisma migrate dev --name 改动说明`，把生成的 `migrations/` 一起提交。
   推上去后服务器会自动 `prisma migrate deploy`（且迁移前自动备份数据库）。

## 异地备份（强烈建议）

权威代码目前只在这一台阿里云服务器。建议把 Gitee 当备份，定期推一份：

```bash
git remote add gitee git@gitee.com:kylezhangjiawei_admin/inogi-ai-office.git
git push gitee main --force     # 首次覆盖旧的分叉历史；之后偶尔 push 即可
```
