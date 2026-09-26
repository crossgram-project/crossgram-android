# Reaction support

QQ message reactions exist in groups only: its one-to-one chats have no reaction
at all. The relay advertises the reaction catalog account-wide, and Telegram
Android treats every private chat as able to react, so the reaction row keeps
appearing in one-to-one chats where the relay then rejects the send.

This feature asks the relay `crossgram.getFeatures` for a one-to-one chat when
it is opened and hides the reaction entry once the answer says
`{"reactions":{"supported":false}}`:

| Patch | Effect |
| --- | --- |
| `ChatActivity.onCreate`-adjacent `onResume` | warms the query, so the first menu already knows the answer |
| `ChatActivity.createMenu` | the private-chat branch `currentUser != null` now also asks the relay |
| `PollItemMenu` / `TodoItemMenu` | the same duplicated bypass is guarded |
| `ChatSelectionReactionMenuOverlay` | the multi-select reaction overlay consults the same answer |

Unknown stays "keep the client's own rules", so a server without the Crossgram
API behaves exactly like upstream, and the group branches keep upstream's own
`available_reactions` check. The poke feature issues the same query; its
`onResume` line is left intact.
