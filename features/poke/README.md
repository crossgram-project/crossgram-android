# Crossgram poke menus

Telegram 没有「戳一戳」，所以修改版客户端把它加进 Telegram 自己围绕头像的菜单里：

- **头像预览菜单**（长按群消息里的头像打开的全屏预览）：戳这条消息的发送者。
  点「戳一戳」发一次；长按这一行会在原地展开 `1 次 / 5 次 / 10 次`，是桌面端
  悬停箭头在触屏上的等价物，数量同样以服务端的 `maxCount` 为上限。
- **小型头像菜单**（无法显示预览时 Telegram 走 `ItemOptions` 兜底）：只加一条
  「戳一戳」，点击发送一次。

入口只在服务器回答「这个会话支持 poke」后才会出现：`ChatActivity.onResume` 会用
`crossgram.getFeatures` 预问一次（每个会话一次，结果按 account + 会话缓存），答案回来
之前菜单里不会有这一项，官方服务器上则永远不会有。

## 服务端交互

| RPC | 用途 |
| --- | --- |
| `crossgram.getFeatures#c3e6b915 peer:InputPeer = DataJSON;` | 询问会话能力，回答形如 `{"poke":{"maxCount":10}}` |
| `crossgram.sendPoke#9a2d47f0 peer:InputPeer user_id:InputUser count:int = Bool;` | 在 `peer` 里戳 `user_id`，`count` 为 1..maxCount |

RPC 走 `ConnectionsManager.sendRequest`，请求类是手写的 `TLObject`（沿用仓库里
`crossgram.getFileUrl` / `crossgram.prepareMediaUpload` 的做法），所以不需要改
TL scheme。戳成功的本地回显由中转端推送 QQ 自己的系统消息完成，历史与未读状态和 QQ 侧一致。

## 官方服务器兼容

1. `crossgram.getFeatures` 返回错误（官方服务器不认这个方法）会把整个账号标记为
   「没有 Crossgram 扩展」，之后不再提问。
2. 只是暂时连不上（错误码为负的本地错误）不会关闭探测，只会退避：同一个会话最快
   `PROBE_RETRY_MS` 之后才会重问一次。
3. 结果按 `account:dialogId` 缓存；没有答案的会话在拿到答案前不显示入口。
