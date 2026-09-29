# 阿里云自建裸仓库 + push 即部署

把 Git 仓库直接放在阿里云服务器上，本地 `git push` 上去就自动部署。**服务器不再需要 `git pull` 外网**，从根上消除 timeout。

```
本地 git push aliyun main
      │  （只传改动，国内→阿里云，很快）
      ▼
服务器裸仓库 /opt/git/inogi-ai-office.git
      │  post-receive 钩子：检出代码 → 跑 scripts/deploy.sh
      ▼
装依赖 → 构建 → 【备份数据库】 → 迁移 → 重启 pm2 → reload nginx
```

> 钩子的输出会**实时回显到你本地 `git push` 的终端**，第一次部署可以一边推一边看完整日志。

现行源码发布先进行类型与分组测试，再构建；已完成阶段按输入与产物校验复用。可选产物模式通过裸仓库 `hooks/artifact-root` 文件配置受信任产物根目录，按收到的完整提交 SHA 选择版本。必须先上传该提交的完整产物，再 push/重试；缺少产物时不会检出，也不会回退到耗时的源码构建。构建机准备、配置兼容要求、传输与回退步骤见 [运维手册](../RUNBOOK.md#失败重试与独立构建产物)。

---

## 前置条件（服务器，一次性）

- 已装 `node`（至少 22.19.0）、`pm2`、`nginx` 和 util-linux 提供的 `flock`；
- 工作目录 `/opt/inogi-ai-office-system` 下有可用的 `apps/api/.env`（含 `DATABASE_URL` 等）；
- 自动备份需要能导出数据库：宿主机装了 `pg_dump`（`apt install postgresql-client`），**或**数据库跑在 docker 容器里（脚本会自动进容器导出）。

---

## 步骤 1：在服务器建裸仓库

```bash
mkdir -p /opt/git
git init --bare /opt/git/inogi-ai-office.git
```

## 步骤 2：装 post-receive 钩子

工作目录 `/opt/inogi-ai-office-system` 里需要先有本仓库代码（你现在已经有）。把钩子拷过去：

升级已安装钩子也需要执行此步；普通推送不会更新裸仓库里的钩子。确认没有发布正在执行后再安装。当前钩子使用与手动发布共用的锁，忙时返回 75，并按收到的提交号检出。

```bash
cp /opt/inogi-ai-office-system/deploy/git-hooks/post-receive \
   /opt/git/inogi-ai-office.git/hooks/post-receive
chmod +x /opt/git/inogi-ai-office.git/hooks/post-receive
```

> 若 node 是用 **nvm** 装的，钩子会自动加载 nvm 让 `node/pm2` 进 PATH。
> 若 `which node` 在 `/usr/bin` 或 `/usr/local/bin`（系统级安装），一般无需额外配置。
> 万一部署时报 `node: command not found`，编辑钩子末尾那行 `export PATH=...` 改成你的实际路径。

## 步骤 3：本地添加远程并首推

在**本地**项目目录：

```bash
git remote add aliyun ssh://root@39.102.98.21/opt/git/inogi-ai-office.git
git push aliyun main
```

这一次 push 会触发第一次真实部署，终端会实时显示部署日志。

---

## 安全保障（请先看）

第一次 push = 一次真实发布。两道保护已内置：

1. **先构建、最后才重启**：`deploy.sh` 在装依赖/构建阶段若失败会直接中止，**此时 pm2 还没重启，线上旧服务照常运行**，不会被搞挂。
2. **迁移前自动备份**：构建成功后、`prisma migrate deploy` 之前，自动把整库导出到 `/opt/inogi-backups/db-<版本>.sql.gz`（默认保留最近 10 份）。**备份失败就中止、不迁移。**

建议第一次部署前，额外手动备份一次数据库求稳。出问题可一键恢复：

```bash
bash /opt/inogi-ai-office-system/deploy/db/restore.sh /opt/inogi-backups/db-xxxx.sql.gz
```

可调环境变量（一般用默认即可）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DEPLOY_DB_BACKUP` | `1` | 设 `0` 关闭自动备份（不推荐） |
| `DEPLOY_BACKUP_DIR` | `/opt/inogi-backups` | 备份目录 |
| `DEPLOY_BACKUP_KEEP` | `10` | 保留最近几份 |
| `POSTGRES_CONTAINER` | `inogi-postgres` | 数据库在 docker 时的容器名 |
| `DEPLOY_METRICS_ENABLED` | `1` | 设 `0` 关闭发布基线记录；采集失败不会影响部署 |
| `DEPLOY_METRICS_DIR` | `/var/log/inogi-deploy` | JSON 发布基线目录 |

---

## 日常发版

之后每次发版，本地一条命令即可：

```bash
git push aliyun main
```

---

## 排错

```bash
# 部署日志会实时回显在 git push 终端；想复现可在服务器手动检出+部署：
git --work-tree=/opt/inogi-ai-office-system --git-dir=/opt/git/inogi-ai-office.git checkout -f main
DEPLOY_SKIP_GIT=1 bash /opt/inogi-ai-office-system/scripts/deploy.sh

# node/pm2 not found：确认钩子能加载到 node（见步骤 2 的 PATH 说明）
# 备份失败：确认宿主机有 pg_dump，或数据库容器在运行；检查 apps/api/.env 的 DATABASE_URL
```
