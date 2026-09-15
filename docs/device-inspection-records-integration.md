# 设备检测记录接口与部署

本模块保存 Windows 已保存的检测快照，提供列表、详情和同设备历史。旧记录不使用后台当前规则重新计算。接口接收成功仅表示已保存，不表示检测通过或设备可放行。

## 部署顺序

1. 备份数据库，按项目正常发布流程执行 `prisma generate` 和 `prisma migrate deploy`。本次新增迁移是 `20260910183000_device_inspection_records`，仅创建一张记录表及索引；没有修改既有配置或检测数据。
2. 为 API 设置独立环境变量 `FACTORY_QC_UPLOAD_TOKEN`，使用随机生成的长令牌；Windows 使用同一令牌。令牌不配置时，上传返回 503。不要把测试 fixture 的令牌用于部署。
3. 构建并发布 API 与前端。访问权限目录会补齐 `page:device-inspection-records`，按需授予角色；已有 `*` 权限管理员可以访问。前端路径为 `/device-inspection-records`。
4. Windows 上传地址为 `https://www.weoxymedical.com/api/factory-qc/records`。先上传一条正式保存的测试记录，核对回执、列表和原始证据，再验证重复上传只产生一条记录。

本次开发验证只使用本地内存数据库替身和 loopback HTTP，未执行真实数据库迁移、线上发布或生产上传。部署迁移和令牌设置仍需按上述步骤执行。

## Windows 上传

`POST /api/factory-qc/records`

- `Content-Type: application/json`
- `Authorization: Bearer <FACTORY_QC_UPLOAD_TOKEN>`
- 整份 UTF-8 HTTP 请求体上限 **2 MiB**，包含外层信息、投影和快照。
- 只接受 `snapshot.mode="Workstation"`、`snapshot.saveStatus="Saved"`，项目数 1～256。正式保存的未完成或中断记录可以上传；正在运行的草稿、演示数据不可上传。

```json
{
  "contractVersion": 1,
  "source": {
    "clientId": "persistent-client-install-id",
    "uploaderAppVersion": "0.6.0",
    "recordAppVersion": null
  },
  "snapshotSchema": "factoryqc.workstation.v1",
  "snapshot": { "说明": "这里必须传入完整已保存记录，不是摘要；具体字段沿用Windows快照" },
  "resultProjection": {
    "mapperVersion": "qc-result-v1",
    "inspectionResult": "NG",
    "items": [{ "id": "QC-009", "result": null }]
  }
}
```

上例仅说明外层结构，`snapshot` 占位对象不可直接上传。快照至少包含 testId、mode、saveStatus、status、productionPass、startedAt、identity、items。项目包含 id、name、status，可附完整 readEvidence、qcRuleEvidence 等证据。投影项目必须与快照项目逐项一一对应，无遗漏、重复或额外编号。项目结果只允许 `PASS`、`NG`、`null`；整体允许 `PASS`、`NG`、`PENDING`。后台保存该投影，不按当前标准重算。`snapshot.productionPass` 单独保存，不从上传成功或上述投影推导。

首次接收为 201，相同内容重传为 200：

```json
{
  "recordId": "server-record-id",
  "testId": "QC-20260910-example",
  "payloadHash": "64位小写SHA256",
  "receivedAt": "2026-09-10T08:00:00.000Z",
  "duplicate": false
}
```

无需额外 Idempotency-Key。唯一键是 `(source.clientId, snapshot.testId)`。同键同内容返回同一记录回执；不同内容返回 409，原记录不变。复检应创建新 testId。Windows 应持久化完整待上传请求，并验证回执的 testId 与 payloadHash。

### 哈希规范

从上传对象中只删除 `source.uploaderAppVersion`，其余字段均参与哈希，包括 recordAppVersion（未知必须明确为 null）、完整快照及结果投影。对象键按 UTF-16 ordinal 顺序递归排序；数组顺序保持；数值及字符串按 ECMAScript `JSON.stringify` 格式编码；无空白；UTF-8 无 BOM；最后计算 SHA-256 小写十六进制。相关跨语言样例见 `device-inspection-records.canonical-vectors.json`。

后台保存首次接收的 uploaderAppVersion。客户端升级只改变传输版本不会引起内容冲突，也不会更新旧记录。数据库唯一索引处理并发重传，不能用进程内锁代替。

### 错误

400 表示版本、结构、日期、投影或参数错误；401 表示上传令牌无效；409 表示相同检测编号内容冲突；413 表示超过 2 MiB；503 表示服务器尚未配置上传令牌。上传令牌仅能上传，不能读取管理页面；管理员登录 JWT 也不能替代上传令牌。原有公开串口/协议下载接口保持不变。

## 管理查询

所有管理 GET 使用现有登录 JWT，要求 `page:device-inspection-records` 权限。没有修改、删除或重算历史记录的接口。

| 方法 | 说明 |
| --- | --- |
| `GET /api/device-inspection-records` | 分页列表 |
| `GET /api/device-inspection-records/:id` | 完整冻结记录详情 |
| `GET /api/device-inspection-records/:id/history` | 同一已验证完整 UID 的全部检测历史，包含当前记录 |

列表参数：page 默认 1；pageSize 默认 25，最大 100；search 最长 128，匹配检测编号、UID、SN、型号、工位和操作员；from/to 按采集时间筛选，必须是包含 Z 或 UTC 偏移的 ISO 时间，边界包含；result 为 PASS/NG/PENDING；abnormalOnly 为 true/false；itemId 与 readStatus 可以联合过滤，必须命中同一个检测项目。history 只接受 page/pageSize。

列表响应为 `{items,total,page,pageSize}`。按 collectionAt、id 倒序。单次列表的总数与行在同一 RepeatableRead 事务读取；不同分页请求之间新记录可能插入，重新查询可刷新。列表不传完整快照 JSON。

每行摘要字段：id、testId、clientId、collectionAt、saveAt、receivedAt、uid、uidVerified、uidShort、serialNumber、model、market、station、operator、firmwareVersion、recordAppVersion、uploaderAppVersion、inspectionResult、productionPass、itemCount、abnormalCount、pendingCount、abnormalItems、ruleVersion、protocolVersion。

- collectionAt 优先用 protocolReadAt，缺失时依次使用 endedAt、startedAt；是整轮检测时刻，不能称为某条串口回包的精确接收时间。
- saveAt 只使用 snapshot.savedAt；旧记录没有此字段时为 null，不把检测结束时间假作保存时间。receivedAt 为服务端首次接收时间。
- uidShort 是完整 UID 尾 8 位，仅便于显示。历史关联必须使用通过 87 完整回包和 CRC-32/ISO-HDLC 校验的完整 96 位 UID；不按尾 8 位、短 CRC UID 或空 SN 猜测同一设备。无可靠 UID 时 history 返回 `{items:[],total:0,page,pageSize,deviceUid:null,available:false,reason}`。
- abnormalItems 包含投影 NG、读取失败、测量未完成、数据有效性未知、中断、不支持、待复检或证据已失效的项目。仅显示的正常信息行不算异常。待判定、待掉电比对属于 pending，并不因此伪装成读取故障。
- 读取状态保留历史语义；QC-009/QC-010 的测量状态 01（字段或规则证据）统一索引为 WaitingMeasurement，项目结果仍保存原投影，不转为 PASS/NG。

详情返回 `{...summary,contractVersion,snapshotSchema,snapshot,resultProjection,payloadHash}`。同机历史返回分页结构加 deviceUid、available、reason；界面做前后比较时应显示双方各自的标准、版本、有效状态与原始数据。

## 开发验证

`apps/api/test/device-inspection-records.spec.ts` 覆盖幂等与并发冲突、冻结投影、UID/CRC 和同机历史、日期与同项目筛选、权限隔离、草稿拒绝、体积限制及真实 Nest HTTP 管线。`device-inspection-records.fixture.ts` 可由 ts-node 单独启动，仅绑定 127.0.0.1、仅使用内存记录与测试凭据，不导入 AppModule、不读取生产环境或连接 Prisma 数据库；仅供本地集成测试。
