# INOGI 供应链任务驾驶舱 · Design Direction Exploration

本目录包含三个不依赖 production 路由的静态原型。三个方向使用同一组采购任务数据、字段、状态和操作，只比较信息层级与视觉组织方式。

## 运行

分别在目录中启动静态服务器：

```text
direction-a · http://localhost:4173/ · Evolution
direction-b · http://localhost:4174/ · Modern Enterprise
direction-c · http://localhost:4175/ · Distinctive Product
```

原型数据来自现有 `供应链任务驾驶舱` 的业务术语和任务状态，交互为本地演示：搜索、筛选、详情抽屉、新建需求、状态动作和空状态均不会写入 production 数据。
