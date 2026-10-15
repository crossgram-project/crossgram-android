# 应用内自动更新（`features/updater`）

将 `LaunchActivity.checkAppUpdate(...)` 接入 `CrossgramUpdate`：

1. 拉取最新 Release 的 `crossgram-update.json`（`https://github.com/crossgram-project/crossgram-android/releases/latest/download/crossgram-update.json`）。
2. 按当前客户端的 `client`（上游分支）、`variant`（ABI）与 `brand`（渠道包名）匹配对应条目。
3. 比对清单中的 `sha256` 与当前已安装 APK 的实际 SHA-256（解决上游 `versionCode` 未变但 Nightly 重新构建的问题）。
4. 若哈希不同且未被用户跳过，弹出更新提示，确认后在应用内下载 APK、校验 SHA-256 并调起系统 `PackageInstaller` 安装。

## 清单结构

```json
{
  "build": 96,
  "assets": [
    {
      "client": "nagram",
      "variant": "arm64",
      "brand": "qq",
      "version": "12.5.1",
      "url": "https://github.com/.../nagram-main-arm64-qq.apk",
      "size": 123456789,
      "sha256": "..."
    }
  ],
  "notes": "本次构建说明"
}
```
