# Android 服务器直接函数 E2E

## 目的与边界

这套测试验证 Android 客户端能否通过自定义 RSA/DC 配置连接真实 Crossgram relay，
并让 relay 正确驱动 QQNT。adb 只负责把命令和参数送进 Android 进程；业务行为必须由
Android 源码中的真实页面或业务函数完成，不使用坐标点击替代函数调用。

测试 APK 只用于受控 AVD。patch 会：

- 在 debug manifest 注册 `CrossgramE2eActivity`；
- 通过 `ServerSwitchConfig.addAndSelect` 写入目标 relay；
- 通过 `LoginActivity` 的手机号页和验证码页方法完成登录；
- 通过 `LaunchActivity.presentFragment` 直接打开 `DialogsActivity`、`ChatActivity`；
- 通过 `SendMessagesHelper.sendMessage` 直接发送文本；
- 通过 `MessagesController.loadMessages` 直接执行首屏、缓存和分页历史加载；
- 在 native debug 测试源码中放行测试签名；
- 用 `CrossgramE2E` logcat marker 和 relay SQLite 记录双重断言结果。

这些改动都由 `features/server-e2e/patch.ts` 语义注入，可重复执行；不会依赖一次性的
`git apply`。测试入口由 `BuildConfig.DEBUG` 和 debug manifest 双重限制，但生成物仍不
应安装在生产设备或对外发布。

## 数据流

```text
android-server.mjs
  -> adb am start (debug command + Base64 parameters)
  -> CrossgramE2eActivity / LaunchActivity.onNewIntent
  -> Android real page or business method
  -> MTProto over 10.0.2.2:4430
  -> Crossgram relay
  -> qqnt-bridge
  -> QQNT
  -> relay read-only inspection + Android log/state assertion
```

## 自动修补与重编

GitHub Actions 的 `Build Android direct-function E2E APK` 会在 push 或手动触发时：

1. checkout patcher；
2. clone 指定 Nagram revision；
3. 应用服务器切换 patch、E2E patch、QQ 品牌和 x86_64 构建准备；
4. 初始化 Nagram native 依赖并编译 debug APK；
5. 上传 APK 与 SHA-256 artifact。

手动触发时可以传 `nagram_ref`。默认构建 `NextAlone/Nagram@main`。

本地等价命令：

```bash
corepack enable
yarn install --immutable
bash scripts/ci/build-e2e-nagram.sh main
```

如果已经有上游源码：

```bash
yarn patch:source --client nagram --source /path/to/Nagram
yarn e2e:source --client nagram --source /path/to/Nagram
yarn brand --client nagram --source /path/to/Nagram --brand qq
yarn prepare-build --client nagram --source /path/to/Nagram --variant x86_64
```

连续执行两次 `yarn e2e:source`，第二次必须报告 `changedFiles: []`。

CI 不读取生产签名。构建脚本用 `mktemp` 和 `keytool` 生成有效期一天的临时 E2E
keystore，通过 `KEYSTORE_PASS`、`ALIAS_NAME`、`ALIAS_PASS` 只传给当前 Gradle 进程，并在
退出时删除。

`NAGRAM_BUILD_ARGS=skip_buildCMakeDebug` 只能用于本机已有匹配 E2E native 产物的增量
构建；新 checkout 或尚未编译过 `jni.c` 放行逻辑的源码必须重编 native。

Windows 手工 native 构建要特别注意：BoringSSL 必须使用 Windows CMake 和 Windows
Ninja，不能混用 MSYS Ninja。此外，`TMessagesProj/src/main/libs/x86_64/libtmessages.49.so`
如果存在，会被 `pickFirst` 优先打进 APK，遮蔽刚由 CMake 生成的新 so；必须先核对 APK
内 so 与 CMake stripped 输出的 SHA-256，不能只看 Gradle 的 `BUILD SUCCESSFUL`。

## AVD 与真实服务器

推荐 API 35 x86_64 AVD。Android Emulator 通过 `10.0.2.2` 访问宿主机，relay MTProto
监听 `0.0.0.0:4430`，WebUI 和 qqnt-bridge 可以继续只监听宿主机回环地址。

安装 APK 后，先授予运行时权限，再运行：

```bash
yarn e2e:android-server --command login
yarn e2e:android-server --command state
yarn e2e:android-server --command dialogs
yarn e2e:android-server --command chat --conversation 479613101
yarn e2e:android-server --command history --conversation 479613101 --source server --count 50
yarn e2e:android-server --command history --conversation 479613101 --source cache --count 50
yarn e2e:android-server --command history --conversation 479613101 --source server \
  --count 50 --max-id <previous-min-id>
```

分页时把上一页 `history_loaded` 的 `min_id` 作为下一次的 `--max-id`。该命令不会打开或
滚动 UI，而是在 Android 进程内注册 `NotificationCenter.messagesDidLoad` 后直接调用
`MessagesController.loadMessages`，marker 会给出 cache/server、实际数量、首尾 ID、
`end` 与耗时。

服务器首屏默认使用 Android 的 `LOAD_FROM_UNREAD`；缓存读取和带 `--max-id` 的分页使用
`LOAD_BACKWARD`。可用 `--load-type` 明确覆盖，或用 `--raw-peer true` 跳过元数据补水，
复现错误 peer 构造。`--cold true` 会先 force-stop app，再由 launcher intent 启动真实
`LaunchActivity`。

冷启动时 `MessagesController` 可能还没有目标群的 `TLRPC.Chat`。驱动不会靠加载“最近
会话”碰运气，而是定向调用真实 `messages.getPeerDialogs`，把响应的 users/chats 交给
`MessagesController.putUsers/putChats` 后再调用 `loadMessages`。对应 marker 是
`history_peer_hydration_started`、`history_peer_hydrated`、`history_peer_ready`；RPC 错误与
响应缺失分别报告 `peer_metadata_rpc`、`peer_metadata_missing`，不会打印标题或正文。

私聊发送使用 relay 的原生 platform user id，runner 会通过只读数据库自动解析其
Telegram user id：

```bash
yarn e2e:android-server --command send \
  --peer-type user \
  --conversation u_example_test_contact \
  --message "Crossgram E2E 中文与空格"
```

消息参数以 Base64 进入 Android，避免 adb shell 把空格截断。`send` 只有同时满足以下
条件才通过：

- Android log 出现 `function_called:sendMessage`；
- relay 的 `mtproto_im_message` 出现文本完全相同且 `outgoing=1` 的记录。

不要向公共群发送测试消息。优先使用明确标记的测试联系人。当前 relay 对
`inputPeerSelf` 返回 `PEER_ID_INVALID`，因此 Saved Messages 暂不能作为无副作用目标。

## 历史记录专项

历史记录不能只以“页面打开成功”为通过。每个目标会话都要核对：

- 首屏从缓存与网络加载后不再停留在 skeleton；
- Android `messages.getHistory` 的 peer 类型/id 与 relay 会话映射一致；
- 返回的消息数、首尾 Telegram message id 与 `mtproto_tl_message_part` 对齐；
- 文本、图片、贴纸/动画、回复关系和发送者至少各有一条可渲染样本；
- 上拉分页后不得返回比 anchor 更新的 id，且最老 id 必须单调减小；页内必须唯一；
- 进程重启后先显示本地缓存，再能接续网络分页；
- 新入站消息经 update 到达，重开页面后仍可从历史取回；
- relay/QQNT 短暂重启或断网恢复后不会永久停留在 loading。

relay 数据与日志只使用 `.agents/skills/inspect-relay/scripts/inspect-relay.mjs` 只读检查。
不要在报告、artifact 或日志中输出 TOTP secret、credentials、auth key、token 或无关消息
正文。

Android 本地缓存应在 `adb shell am force-stop <package>` 后，把 `files/cache4.db`、
`files/cache4.db-wal`、`files/cache4.db-shm` 三件套按二进制原样导出到同一目录，再执行：

```bash
yarn inspect:android-cache --db /path/to/cache4.db --dialog-id -1670195612
```

该脚本以 SQLite `readOnly` 和 `PRAGMA query_only` 双重只读方式打开快照，只输出
`messages_v2` 的数量、ID/日期边界和序列化数据长度，不读取或泄露消息正文。只复制主库
会漏掉 WAL 中尚未 checkpoint 的历史记录，不能用于缓存数量断言。

频道分页有一个容易误判的 Telegram 语义：Android 使用 `add_offset=-1`，所以响应可合法
包含一条等于 `--max-id` 的 anchor，由 Android 存储层去重。断言允许这一个边界重叠，
但拒绝任何更大的 ID，并要求 `min_id < requested_max_id`。旧实现把负 offset 的数据库
窗口从“全局最新消息”处读取，深分页因此只返回 1 条更新消息；relay 现在会把
`add_offset=-1` 的投影窗口锚定在指定消息处。

曾经出现“数据库已有 222 条，但 probe 只返回 1 条”的情况，根因也是测试参数语义：
首屏不能一律使用 `LOAD_BACKWARD + maxId=0`。首屏应走 `LOAD_FROM_UNREAD`，分页才以
上一页 `min_id` 作为 anchor。排查时必须同时核对 `messages_v2`、`messages_holes` 和三件套
WAL 快照，不能仅凭单次 callback 数量判断服务器没有历史。

如果定向补水返回 `QQNT bridge 503: QQNT kernel is not ready`，先检查
`http://127.0.0.1:18767/v1/status` 的 `ready`。bridge 在 QQ session 初始化之后才注入时，
可能只有 kernel wrapper 而没有 session attach；应通过 `qqnt-bridge/start.ps1` 重启，
确认 `ready=true` 后再测，不应把它误报成 Android peer 错误。

## 当前已验证与已知失败

已验证：自定义 RSA 登录、临时/永久 auth key 绑定、API layer 227、dialogs、群聊和
私聊历史、图片历史、实时入站 update、文本直发到 QQNT、前台状态读取。2026-07-29 的
API 35 x86_64 AVD 回归还定量通过了：干净缓存冷启动定向补水、群历史 server 首屏 50、
cache 首屏 50、server 第二页 50、私聊历史 9；只读 SQLite 快照中该群持久化 102 条，
所有 runner 页内 ID 均严格降序且唯一。

仍需修复/回归：

- relay 入站处理曾出现 `database is locked`；
- `inputPeerSelf` 发送返回 `PEER_ID_INVALID`；
- `account.getAutoDownloadSettings` 返回 `METHOD_NOT_IMPLEMENTED`；
- `contacts.resolveUsername`、贴纸集合等兼容 RPC 有重复错误噪声。

发现问题时，先保留 Android marker、RPC 名称、peer/message id、时间戳和只读数据库
行号，再修改 Android driver 或 relay。截图只用于验证函数调用后的渲染，不作为驱动
输入。
