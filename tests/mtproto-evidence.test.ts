import { describe, expect, it } from "vitest";

import {
  countSendRequests,
  findRpcError,
  findRpcMethod,
  findSendRequest,
  latestEventId,
} from "../scripts/e2e/mtproto-evidence.mjs";

function sendEvent(id: number, message: string) {
  return {
    id,
    direction: "client->server",
    messageId: `request-${id}`,
    payload: {
      _: "invokeAfterMsgs",
      query: {
        _: "invokeWithLayer",
        query: { _: "messages.sendMessage", message },
      },
    },
  };
}

describe("Android send-unblock MTProto evidence", () => {
  it("finds a nested send request and its permanent RPC rejection", () => {
    const request = sendEvent(11, "blocked-recipient");
    const rejection = {
      id: 12,
      direction: "server->client",
      requestMessageId: "request-11",
      payload: {
        _: "rpc_result",
        result: {
          _: "mt_rpc_error",
          errorCode: 403,
          errorMessage: "CHAT_WRITE_FORBIDDEN",
        },
      },
    };
    const snapshot = { events: [request, rejection] };

    expect(findRpcMethod(request.payload, "messages.sendMessage")).toMatchObject({
      message: "blocked-recipient",
    });
    expect(findSendRequest(snapshot, "blocked-recipient")).toBe(request);
    expect(findRpcError(snapshot, "request-11", 403, "CHAT_WRITE_FORBIDDEN")).toBe(rejection);
    expect(latestEventId(snapshot)).toBe(12);
  });

  it("counts repeated wire requests instead of accepting a local function marker", () => {
    const snapshot = {
      events: [
        sendEvent(20, "blocked-recipient"),
        sendEvent(21, "other-message"),
        sendEvent(22, "blocked-recipient"),
      ],
    };

    expect(countSendRequests(snapshot, "blocked-recipient")).toBe(2);
    expect(countSendRequests(snapshot, "missing")).toBe(0);
  });
});
