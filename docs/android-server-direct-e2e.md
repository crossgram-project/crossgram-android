# Android 服务器直接函数 E2E

`features/server-e2e` 是 `crossgram-android` 的受控端到端测试模块（常规 `yarn patch:source` 与 Release 构建不启用，仅在显式执行 `yarn e2e:source` 时注入）。

adb 仅用于下发命令与 Base64 参数，所有操作均直接调用 Android 客户端内部的真实页面与 Controller/Helper 方法，不使用屏幕坐标点击。

## 1. 构建 E2E APK

```bash
corepack enable
yarn install --immutable
bash scripts/ci/build-e2e-nagram.sh main
```

对已有上游源码目录手动打补丁：

```bash
yarn patch:source --client nagram --source /path/to/Nagram
yarn e2e:source --client nagram --source /path/to/Nagram
yarn brand --client nagram --source /path/to/Nagram --brand qq
yarn prepare-build --client nagram --source /path/to/Nagram --variant x86_64
```

> Windows 本地编译注意：若 `TMessagesProj/src/main/libs/x86_64/libtmessages.49.so` 存在，会遮蔽 CMake 新编译出的同名 `.so`，重编 Native 代码前需先删除该预编译文件。

## 2. 运行 AVD E2E 命令

Android 模拟器通过 `10.0.2.2:4430` 连接宿主机 Crossgram 服务：

```bash
# 登录与会话列表
yarn e2e:android-server --command login
yarn e2e:android-server --command state
yarn e2e:android-server --command dialogs
yarn e2e:android-server --command dialog-update --conversation 1084013940

# 贴纸与历史记录
yarn e2e:android-server --command stickers --expect-title "QQ 收藏表情"
yarn e2e:android-server --command history --conversation 479613101 --source server --count 50
yarn e2e:android-server --command history --conversation 479613101 --source cache --count 50

# 媒体直连与中转回退下载
yarn e2e:android-server --command download --conversation <conv-id> --target-id <tl-id> --transport direct
yarn e2e:android-server --command download --conversation <conv-id> --target-id <tl-id> --transport relay

# 消息收发与操作（仅限测试私聊或白名单测试群）
yarn e2e:android-server --command send --peer-type user --conversation <uid> --message "测试消息"
yarn e2e:android-server --command reply --peer-type user --conversation <uid> --target-id <tl-id> --message "回复"
yarn e2e:android-server --command edit --peer-type user --conversation <uid> --target-id <tl-id> --message "编辑"
yarn e2e:android-server --command delete --peer-type user --conversation <uid> --target-id <tl-id>
yarn e2e:android-server --command reaction --peer-type user --conversation <uid> --target-id <tl-id> --reaction 👍
```

## 3. 检查 Android 本地 SQLite 缓存

先停止应用并将 `cache4.db`、`cache4.db-wal`、`cache4.db-shm` 一并导出到同一目录，再执行只读检查：

```bash
yarn inspect:android-cache --db /path/to/cache4.db --dialog-id -1670195612
```
