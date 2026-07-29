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

## AVD 与真实服务器

推荐 API 35 x86_64 AVD。Android Emulator 通过 `10.0.2.2` 访问宿主机，relay MTProto
监听 `0.0.0.0:4430`，WebUI 和 qqnt-bridge 可以继续只监听宿主机回环地址。

安装 APK 后，先授予运行时权限，再运行：

```bash
yarn e2e:android-server --command login
yarn e2e:android-server --command state
yarn e2e:android-server --command dialogs
yarn e2e:android-server --command chat --conversation 479613101
```

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
- 上拉分页后最老 id 单调减小，且没有重复/跳页；
- 进程重启后先显示本地缓存，再能接续网络分页；
- 新入站消息经 update 到达，重开页面后仍可从历史取回；
- relay/QQNT 短暂重启或断网恢复后不会永久停留在 loading。

relay 数据与日志只使用 `.agents/skills/inspect-relay/scripts/inspect-relay.mjs` 只读检查。
不要在报告、artifact 或日志中输出 TOTP secret、credentials、auth key、token 或无关消息
正文。

## 当前已验证与已知失败

已验证：自定义 RSA 登录、临时/永久 auth key 绑定、API layer 227、dialogs、群聊和
私聊历史、图片历史、实时入站 update、文本直发到 QQNT、前台状态读取。

仍需修复/回归：

- 历史首屏偶发长时间 skeleton，需完成分页/缓存定量测试；
- relay 入站处理曾出现 `database is locked`；
- `inputPeerSelf` 发送返回 `PEER_ID_INVALID`；
- `account.getAutoDownloadSettings` 返回 `METHOD_NOT_IMPLEMENTED`；
- `contacts.resolveUsername`、贴纸集合等兼容 RPC 有重复错误噪声。

发现问题时，先保留 Android marker、RPC 名称、peer/message id、时间戳和只读数据库
行号，再修改 Android driver 或 relay。截图只用于验证函数调用后的渲染，不作为驱动
输入。
