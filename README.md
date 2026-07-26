# Crossgram Android patcher

Crossgram 在 Telegram Android 及其第三方客户端源码上语义地注入服务器切换能力，并通过 GitHub Actions 自动构建多个品牌和 ABI 版本。patcher 使用 TypeScript、Node.js 24 与 Yarn 4；大段 Java/C++/资源代码保存在 `features/server-switch/files`，不依赖 `git apply`。

## 已支持的上游

| 客户端 | 上游 | 登录页入口 |
| --- | --- | --- |
| Nagram | `NextAlone/Nagram` | 原自定义后端菜单 |
| Telegram | `DrKLO/Telegram` | 登录页服务器按钮 |
| Nnngram | `NextAlone/Nnngram` | 更多菜单 |
| Nullgram | `qwq233/Nullgram` | 更多菜单 |

patch 保留每个上游原有的 API ID/hash 获取逻辑。Nagram、Nnngram 自带的 API 凭据切换功能也不会被覆盖。

Nnngram 与 Nullgram 上游没有公开其私有 `google-services.json`；品牌步骤会生成明确标记的本地占位配置，并关闭私有 Crashlytics 上传，使 release 可以构建，但这些版本没有上游 Firebase 推送/崩溃上传能力。Telegram/Nagram 发布了配置时，patch 会为新的 `.crossgram.<channel>` 包名添加匹配 client。Telegram API ID/hash 与 Firebase 配置是两套独立凭据。

## 服务器配置

在登录页选择“服务器”后可以切换官方配置、已有自定义配置或新增 JSON 配置。“新增”对话框支持直接输入和从剪贴板读取。

```json
{
  "name": "我的自定义服务器",
  "enable_special_config": false,
  "host": "192.168.1.100",
  "port": 4430,
  "rsa_key": "-----BEGIN RSA PUBLIC KEY-----\nMIIBCgKCAQEA...\n-----END RSA PUBLIC KEY-----",
  "dcs": [
    { "id": 1, "ip": "192.168.1.100", "port": 4430 },
    { "id": 2, "ip": "192.168.1.100", "port": 4430 },
    { "id": 3, "ip": "192.168.1.100", "port": 4430 },
    { "id": 4, "ip": "192.168.1.100", "port": 4430 },
    { "id": 5, "ip": "192.168.1.100", "port": 4430 }
  ]
}
```

- `name`、`host`、`port`、`rsa_key` 必填。
- `enable_special_config` 可选，默认 `true`；为 `false` 时禁止 Telegram 备用/special config 请求。
- `dcs` 可选。缺少的 DC 1–5 自动使用顶层 `host`/`port` 补齐；DC ID 不可重复。
- RSA key 必须为 PKCS#1 `BEGIN RSA PUBLIC KEY` PEM。native 层根据公钥计算 MTProto fingerprint。

自定义服务器和账号槽位选择保存在应用私有目录的 `server-switch/servers.json` 中，并通过 `AtomicFile` 原子写入。每个 Telegram 账号槽位可以选择不同服务器；选择官方配置会恢复原版服务器、RSA key 和 special config 行为。

## 本地使用

要求 Node.js 22+（CI 使用 Node.js 24）。

```bash
corepack enable
yarn install --immutable

yarn patch:source --client nagram --source /path/to/Nagram
yarn brand --client nagram --source /path/to/Nagram --brand qq
yarn prepare-build --client nagram --source /path/to/Nagram --variant arm64
yarn check
```

`--client` 可选 `nagram`、`telegram`、`nnngram`、`nullgram`。patch 和构建准备操作可重复执行；当上游语义锚点漂移、消失或出现歧义时会明确失败，避免静默修改错误位置。

## 品牌与架构

每次发布构建五个渠道。应用名称和包名后缀分别为：

| 渠道 | 应用名称 | 包名后缀 |
| --- | --- | --- |
| `qq` | QQ · Cross | `.crossgram.qq` |
| `wechat` | 微信 · Cross | `.crossgram.wechat` |
| `wecom` | 企业微信 · Cross | `.crossgram.wecom` |
| `dingtalk` | 钉钉 · Cross | `.crossgram.dingtalk` |
| `discord` | Discord · Cross | `.crossgram.discord` |

`assets/branding` 中的五张图标由 Apple iTunes Lookup API 按官方 bundle ID 下载并固定，CI 直接使用这些官方高分辨率原图，避免并行构建时受到接口限流。架构 variant 为：

| variant | ABI |
| --- | --- |
| `armAll` | `armeabi-v7a`, `arm64-v8a` |
| `arm64` | `arm64-v8a` |
| `x86_64` | `x86_64` |
| `universal` | `armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64` |

## 自动发布

`.github/workflows/release.yml` 每天查询四个上游的 latest release；没有 release 时回退到最新 tag，再回退到默认分支。四个客户端 × 四个架构形成 16 个相互隔离的并行 job，`fail-fast` 关闭，单个上游或 ABI 失败不会阻断其他构建和发布。每个成功 job 顺序生成五个品牌 APK、SHA-256 校验文件，并汇总到该上游独立的 GitHub Release。

手动运行 workflow 时可将 `client` 选为单个上游以快速调试；定时任务和默认 `all` 仍生成完整 16-job 矩阵。

Nnngram 与 Nullgram 的仓库只提交了 ARM 版 FFmpeg/libvpx 和私有 Rust
预编译库。`x86_64` 与 `universal` job 会用对应客户端的 NDK 编译同版本
FFmpeg 7.1.1/libvpx，并在私有 Rust 库缺失的 ABI 上使用等价的 Android
日志后备实现。

release 签名使用以下 Actions Secrets：

- `CROSSGRAM_KEYSTORE_BASE64`
- `CROSSGRAM_KEYSTORE_PASSWORD`
- `CROSSGRAM_KEY_ALIAS`
- `CROSSGRAM_KEY_PASSWORD`

本地 keystore 和凭据位于被忽略的 `artifacts/` 目录，不应提交到 Git。
