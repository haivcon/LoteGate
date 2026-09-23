# LotGate — 基于 X Layer 和 TapeOut 的批量拍卖应用

LotGate 面向单一运营者，提供批量拍卖流程：录入订单 → 锁定输入 → 排队调用 X Layer 上的 TapeOut CPU → 检查分配结果 → 导出 JSON 回执。

**功能范围仅限计算：不托管或转移资产。** `eth_call` 不会将会话状态写入区块链。后端管理输入和调用之间的状态；运营端不会回退到本地计算。

## 评审快速启动

需要 **Node.js >=22**、npm 和能够通过 HTTPS 访问 RPC 的网络环境。无需钱包、私钥或额外运行时依赖。

```sh
git clone https://github.com/haivcon/LoteGate.git
cd LoteGate
```

Windows PowerShell：

```powershell
$env:LOTGATE_TOKEN = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
$env:LOTGATE_TOKEN # 将令牌复制到登录界面，请勿公开分享
npm start
```

macOS/Linux：

```sh
export LOTGATE_TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
printf '%s\n' "$LOTGATE_TOKEN"
npm start
```

打开 **http://127.0.0.1:4173**，输入令牌并创建批次。添加价格为 20、数量为 3 的买单，以及价格为 10、数量为 3 的卖单；锁定订单后启动执行。预期成交价为 10，成交量为 3。会话数据保存在 `data/` 中，不提交到 Git。

**实时 RPC 执行可能需要数分钟**，并非即时交易。请勿发送真实资金。

## 架构与电路

- `web/operator/`：越南语运营界面，用于创建和执行批次、下载回执。本次文档汉化不改变界面语言。
- `scripts/operator-server.mjs`：HTTP API，包含身份验证、来源检查和请求限制。
- `scripts/batch-service.mjs`：串行队列、修订版本检查、磁盘存储、单写入者锁和 API 幂等处理。
- `src/async-session.mjs`、`scripts/xlayer-runtime.mjs`：异步执行，将 CPU 返回的状态传入下一次 RPC 调用，并在固定区块检查电路字节和维度。
- `src/verify.mjs`：独立算术校验器，检查结果、数量守恒和订单限价。
- `circuits/serial/`：实际运行使用的三个电路产物，包括 BLIF、二进制文件和清单。
- `deployment/xlayer.json`：公开部署标识。其中的验证说明是历史记录，不构成独立认证。

X Layer 链 ID 为 **196**，CPU 地址为 **`0xAa13ae45b0B2D52f210Ad7Ef12997113a0ebAF21`**。退款电路编号为 **#1**，串行乘法器为 **#2**，串行控制器为 **#3**。默认运行时 RPC 为 `https://tapeout.net/rpc-xlayer`，可通过 `XLAYER_RPC` 覆盖。

买单按价格降序排列，卖单按价格升序排列；同价订单按录入顺序优先。统一手续费前成交价为最后一笔已成交卖单的限价。价格和数量采用整数报价单位与整数数量单位，不直接表示带小数的代币金额。卖方手续费按每笔订单向下取整。

## 测试与复现

`npm run verify` 执行运营端、拍卖规则、回执及产物校验和测试，无需解析器或 RPC。`src/reference-controller.mjs` 中的算术模型仅用于测试和基准结果对照，不是运营端的备用执行路径。

只有重新生成或核对构建产物（`npm run generate:serial`、`npm run check:serial`）才需要经过审阅的外部 TapeOut 解析器。其 SHA-256 必须为：

```text
a794be064f8a0e1317f2de4ed909cc397f24a6836c048a881b124afffdf42084
```

解析器必须导出 `parse`、`expand`、`compile`、`decode`、`encode` 和 `limits`。由于尚未确认再分发权限，仓库**不包含第三方解析器副本**。请通过获授权的渠道向项目提交者或 TapeOut 提供方获取对应快照。这是当前的构建复现限制。运营端使用已提交的二进制文件，启动和调用 RPC 均不需要该解析器。

以下解析器路径为示例，请替换为实际文件路径。

```powershell
$env:TAPEOUT_PARSER = 'path/to/reviewed-parser.mjs'
npm run verify
npm run check:serial
```

```sh
export TAPEOUT_PARSER=/path/to/reviewed-parser.mjs
npm run verify
npm run check:serial
```

实时基准测试：`node scripts/benchmark-operator.mjs 2`。该命令调用 RPC，但不广播交易；报告写入 `reports/`，不提交到 Git。

回执验证：`node scripts/verify-receipt.mjs path/to/receipt.json`。请替换为实际导出的回执路径。

## 信任边界与未完成工作

回执验证检查哈希和算术结果，**不能**证明下单者签名、订单录入的完整性、RPC 是否实际执行或付款是否发生。系统仍信任运营者和文件系统。目前尚无独立用户账户、取消功能或完整审计日志；虽然 API 支持 `requestId`，界面尚未发送该字段。

排队任务可在重启后恢复；停机时正在运行的任务会变为 `INTERRUPTED`，需要显式重试。确认原进程已停止之前，不得删除遗留锁文件。投入生产前仍需验证崩溃恢复、运营界面浏览器行为、代表性负载、备份恢复、HTTPS、进程监督和部署来源。

详细说明：[运营端指南](OPERATOR.md)、[运营模型](OPERATING-MODEL.md)。仓库仅保留运营端应用、实际使用的三个电路及直接相关的检查工具。
