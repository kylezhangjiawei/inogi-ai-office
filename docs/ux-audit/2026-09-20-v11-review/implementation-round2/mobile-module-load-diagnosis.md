# 移动驾驶舱开发模块加载诊断

问题：在本地 `/production-m` 打开移动驾驶舱时，动态导入 `MobileRDCockpit.tsx` 失败；页面刷新后仍失败，而主模块 GET 返回 200。

## 已确认原因

运行中的 Vite 开发服务持有旧的依赖优化元数据，但磁盘优化缓存目录已经缺失。不是页面业务接口或图标包下载失败。

- 递归检查 MobileRDCockpit 的静态模块依赖闭包，共 115 个模块，其中 114 个返回 200。
- 唯一失败模块：`/node_modules/.vite-app/deps/react-dom.js?v=5f76666f`，返回 **504 Outdated Optimize Dep**，空响应。去掉版本参数请求同一依赖仍为同样结果。
- 主模块与增加查询参数后的主模块均为 200，返回的导入路径仍指向上述旧依赖。
- `node_modules/.vite-app` 存在且为空；`deps`、`deps/_metadata.json`、`deps/react-dom.js` 均不存在。目录最后修改时间为 2026-09-20 07:38:35 UTC。仅据此不能确定是谁或哪个进程移除了缓存。
- 同闭包的 lucide 模块约 1.03 MB，GET 为 200、约 7 ms；没有观察到图标模块失败或 API 代理请求参与本次模块加载。
- 检查当前安装的 Vite `optimizedDepsPlugin.load`：优化依赖读盘失败且内存 metadata 仍存在该文件时，会抛出 `ERR_OUTDATED_OPTIMIZED_DEP`，中间件转换为本次观察到的 504 状态。这也解释了为什么已进入内存缓存的其他依赖仍返回 200，但刷新页面无法修复首次读盘失败的依赖。

## 恢复方式

重启当前本地 Vite 服务，由正常依赖优化流程重新建立缺失缓存，再核对新的模块依赖闭包。无需改变 MobileRDCockpit 业务、降级组件、移除图标或扩展代理。是否有后台脚本再次清理活动缓存尚无证据；不能仅凭此错误推断需要修改业务代码或 Vite 配置。

GET 原始证据：`mobile-module-get-audit.json`。本诊断没有操作浏览器，没有业务数据写入或部署。

## 恢复复核

主任务仅更新 `vite.config.ts` 文件修改时间，触发既有 watcher 重启，没有修改文件内容或业务逻辑。`dev-server.log` 确认本地时间 16:01:55 开始并完成 Vite 重启，API 服务未因此停止。

- `node_modules/.vite-app/deps` 与 `_metadata.json` 已重新生成。
- MobileRDCockpit 主模块引用新的 `react-dom.js?v=94dfa328`；该模块返回 **200 OK**。
- 重新递归检查相同静态模块依赖闭包，**115 / 115 全部返回 200**，没有失败模块。
- 恢复后的原始 GET 证据：`mobile-module-get-after-restart.json`。浏览器页面呈现仍由主任务统一复核。
