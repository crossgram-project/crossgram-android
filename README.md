# Crossgram Android Patcher

[![一键构建并发布](https://img.shields.io/badge/GitHub_Actions-一键构建并发布-2088FF?logo=githubactions&logoColor=white)](https://github.com/crossgram-project/crossgram-android/actions/workflows/release.yml)

向 Telegram Android 及第三方衍生客户端源码注入 Crossgram 特性的源码补丁工具（基于 TypeScript / Node.js 24，不依赖 `git apply`）。

## 注入特性

- **服务器切换（`features/server-switch`）**：在登录页按账号槽位配置自定义 MTProto 服务器（地址、端口、RSA 公钥、DC 列表），保存在应用私有目录 `server-switch/servers.json`。
- **媒体 HTTP 直连下载（`features/direct-download`）**：对 `bridge-media:` 文件先调用 `crossgram.getFileUrl` 获取 CDN 直链并发起单次 HTTP（或断点续传 `Range`）请求，失败时自动回退到 `upload.getFile` 中转下载。
- **秒传与预检上传（`features/fast-upload`）**：上传本地文件前在后台计算 MD5、SHA-1、每 1 MiB 累计 SHA-1 与前 10 MiB MD5，调用 `crossgram.prepareMediaUploadV2` 查询 QQ 秒传及服务端 Highway 流式上传；命中秒传时直接跳过 `upload.saveFilePart`。
- **原始动图直通（`features/raw-animation`）**：直接解码并渲染原始 GIF / APNG 动图与贴纸。
- **戳一戳（`features/poke`）**：在支持 `poke` 的群聊/私聊头像菜单中加入「戳一戳」（单击 1 次，长按展开 1 / 5 / 10 次），详见 [`features/poke`](features/poke/README.md)。
- **合并转发与撤回标记（`features/merged-forward` / `features/recalled`）**：支持打开合并转发记录与显示已撤回消息标记。
- **应用内更新（`features/updater`）**：从 Crossgram Release 的 `crossgram-update.json` 检查 APK SHA-256 并在应用内下载安装，详见 [`features/updater`](features/updater/README.md)。
- **受控 E2E 入口（`features/server-e2e`）**：默认关闭，仅在显式执行 `yarn e2e:source` 时注入，详见 [Android 服务器直接函数 E2E](docs/android-server-direct-e2e.md)。

## 支持的上游客户端

| 客户端 | 上游仓库 | 登录页服务器入口 | 发布 ABI |
|---|---|---|---|
| Nagram | `NextAlone/Nagram` | 自定义后端菜单 | `arm64`, `x86_64` |
| Telegram | `DrKLO/Telegram` | 登录页服务器按钮 | `arm64`, `x86_64` |
| Mercurygram | `Mercurygram/Mercurygram` | 登录页服务器按钮 | `arm64`, `x86_64` |
| Nnngram | `NextAlone/Nnngram` | 右上角更多菜单 | `arm64` |
| Nullgram | `qwq233/Nullgram` | 右上角更多菜单 | `arm64` |
| Forkgram | `forkgram/TelegramAndroid` | 登录页服务器按钮 | `arm64` |

## 服务器配置 JSON

在登录页点击「服务器」可切换官方服务器或导入自定义 JSON（支持剪贴板粘贴）：

```json
{
  "name": "Crossgram",
  "enable_special_config": false,
  "host": "192.168.1.100",
  "port": 4430,
  "rsa_key": "-----BEGIN RSA PUBLIC KEY-----\nMIIBCgKCAQEA...\n-----END RSA PUBLIC KEY-----",
  "dcs": [
    { "id": 1, "ip": "192.168.1.100", "port": 4430 }
  ]
}
```

- `name`、`host`、`port`、`rsa_key`（PKCS#1 `BEGIN RSA PUBLIC KEY` PEM）必填。
- `enable_special_config` 默认 `true`；设为 `false` 时禁用 Telegram 官方备用配置拉取。
- `dcs` 可选，未列出的 DC 1–5 自动使用顶层 `host` 与 `port` 补齐。

## 本地使用

```bash
corepack enable
yarn install --immutable

yarn patch:source --client nagram --source /path/to/Nagram
yarn brand --client nagram --source /path/to/Nagram --brand qq
yarn prepare-build --client nagram --source /path/to/Nagram --variant arm64
yarn check
```

- `--client`：`nagram` | `telegram` | `nnngram` | `nullgram` | `mercurygram` | `forkgram`
- `--brand`：`qq`（QQ · Cross）| `wechat`（微信 · Cross）| `wecom`（企业微信 · Cross）| `dingtalk`（钉钉 · Cross）| `discord`（Discord · Cross）
- `--variant`：`arm64` | `armAll` | `x86_64` | `universal`

## 自动构建与发布

`.github/workflows/release.yml` 每日拉取各上游最新 Release/Tag，并行构建 9 个客户端/ABI 组合（每个组合生成 5 个品牌渠道 APK），汇总发布到单个 GitHub Release。

签名与可选 API 凭据通过 Actions Secrets 配置：
- `CROSSGRAM_KEYSTORE_BASE64`、`CROSSGRAM_KEYSTORE_PASSWORD`、`CROSSGRAM_KEY_ALIAS`、`CROSSGRAM_KEY_PASSWORD`
- `CROSSGRAM_TELEGRAM_API_ID`、`CROSSGRAM_TELEGRAM_API_HASH`（可选，成对覆盖默认 API 身份）
