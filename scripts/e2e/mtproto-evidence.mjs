function nestedObjects(value) {
  if (!value || typeof value !== "object") return [];
  return Array.isArray(value) ? value : Object.values(value);
}

export function findRpcMethod(payload, method) {
  if (!payload || typeof payload !== "object") return undefined;
  if (payload._ === method) return payload;
  for (const child of nestedObjects(payload)) {
    const found = findRpcMethod(child, method);
    if (found) return found;
  }
  return undefined;
}

export function latestEventId(snapshot) {
  return Math.max(0, ...(snapshot.events ?? []).map((event) => Number(event.id) || 0));
}

export function findSendRequest(snapshot, message) {
  return (snapshot.events ?? []).find((event) => {
    if (event.direction !== "client->server") return false;
    const request = findRpcMethod(event.payload, "messages.sendMessage");
    return request?.message === message;
  });
}

export function countSendRequests(snapshot, message) {
  return (snapshot.events ?? []).filter((event) => {
    if (event.direction !== "client->server") return false;
    const request = findRpcMethod(event.payload, "messages.sendMessage");
    return request?.message === message;
  }).length;
}

export function findRpcError(snapshot, requestMessageId, errorCode, errorText) {
  return (snapshot.events ?? []).find((event) => {
    if (event.direction !== "server->client" || event.requestMessageId !== requestMessageId) return false;
    const error = findRpcMethod(event.payload, "mt_rpc_error");
    return error?.errorCode === errorCode
      && (errorText === undefined || String(error.errorMessage).includes(errorText));
  });
}
