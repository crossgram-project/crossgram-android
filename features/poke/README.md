# 戳一戳菜单（`features/poke`）

在群消息与私聊头像菜单中添加「戳一戳」入口：

- **长按头像预览菜单**：点击「戳一戳」发送 1 次；长按该项展开 `1 次 / 5 次 / 10 次` 连戳（上限由服务端 `maxCount` 决定）。
- **无预览小型菜单（`ItemOptions`）**：提供单次「戳一戳」。

## 服务端交互与兼容

| RPC | 说明 |
|---|---|
| `crossgram.getFeatures#c3e6b915 peer:InputPeer = DataJSON;` | 查询当前会话能力（如 `{"poke":{"maxCount":10}}`） |
| `crossgram.sendPoke#9a2d47f0 peer:InputPeer user_id:InputUser count:int = Bool;` | 向目标用户发送 `count` 次戳一戳 |

- `ChatActivity.onResume` 按 `account:dialogId` 缓存查询结果；未收到支持响应前不显示菜单入口。
- 若服务端返回方法未知错误（如连接官方 Telegram 服务器），整个账号标记为不支持并不再发起查询。
