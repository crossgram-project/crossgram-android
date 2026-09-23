# Crossgram 自动更新（Android）

上游各个 fork 的更新检查都指向它们自己的发布源（Nagram 的元数据频道、各 fork 自己的
GitHub Release、官方客户端的 `help.getAppUpdate`），在 Crossgram 的 relay 上这些入口
拿不到 Crossgram 的构建，所以装好的 APK 永远不会提示新版本。

这个 feature 把 `LaunchActivity.checkAppUpdate(...)` 的每个重载都接到 `CrossgramUpdate`：

1. 读取统一 Release 里的 `crossgram-update.json`
   （`https://github.com/crossgram-project/crossgram-android/releases/latest/download/crossgram-update.json`）；
2. 用「上游 fork（client）+ 设备 ABI（variant）+ 包名后缀（brand）」选出自己那一条；
3. 把清单里的 `sha256` 和**当前已安装 APK** 的 sha256 比对，只有真的不一样才提示更新；
4. 用户确认后直接在应用内下载该 APK（校验 sha256），再用系统安装器安装。

自动检查沿用上游的调用点（启动/resume/设置项），间隔 12 小时；提示过的构建号和用户
选择「跳过此版本」的构建号都会记住，同一个 nightly 不会反复打扰。

## 清单格式

```json
{
  "build": 96,
  "assets": [
    {
      "client": "nagram",
      "variant": "arm64",
      "brand": "qq",
      "version": "12.5.1",
      "url": "https://github.com/.../nagram-main-arm64-qq-Nagram-v12.5.1-null.apk",
      "size": 123456789,
      "sha256": "..."
    }
  ],
  "notes": "本次构建说明"
}
```

`build` 是产生该 Release 的 workflow run number，`assets` 由 Release 工作流的 publish
步骤根据实际产物生成（APK 文件名里已经包含 client/variant/brand 与 sha256）。

## 为什么比对 APK 哈希而不是版本号

nightly 每天都重新构建出内容不同的 APK，但每个 fork 的 versionCode 只在上游发版时
变化，所以「已安装的 APK 和清单里的 APK 是不是同一份」只能靠哈希判断：哈希相同就是
最新，不同（且没被跳过）才提示。这样既不会漏掉真正的更新，也不会在内容没变时反复提示。

## 说明

- 更新只会装到同一个 applicationId（同一个品牌），不会把 QQ · Cross 换成别的品牌；
- 安装走 `PackageInstaller` 会话，系统仍会弹出安装确认；会话创建失败时回退到浏览器
  打开 Release 资产；
- 清单缺失、网络失败或找不到自己的条目时静默跳过，不影响应用启动。
