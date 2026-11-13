#define NODE_ID "ws-01"
#define NODE_PROTOCOL "WebSocket"
#include "SmartPondShared.h"
#include <WebSocketsClient.h>

WebSocketsClient websocket;
String authHeader;
uint32_t nextSend = 0;

void onWsEvent(WStype_t type, uint8_t *payload, size_t len) {
  switch (type) {
    case WStype_CONNECTED: Serial.println("WebSocket connected"); break;
    case WStype_DISCONNECTED: Serial.println("WebSocket disconnected"); break;
    case WStype_TEXT:
      Serial.print("WebSocket ack: ");
      Serial.write(payload, len);
      Serial.println();
      break;
    default: break;
  }
}

void setup() {
  initShared();
  authHeader = String("X-Device-Token: ") + DEVICE_TOKEN;
  websocket.begin(SERVER_IP, SERVER_PORT, "/ingest/ws");
  websocket.setExtraHeaders(authHeader.c_str());
  websocket.setReconnectInterval(3000);
  websocket.onEvent(onWsEvent);
  nextSend = millis() + SEND_INTERVAL_MS;
}

void loop() {
  handleSerialMode();
  ensureWifi();
  websocket.loop();
  if (static_cast<int32_t>(millis() - nextSend) >= 0) {
    nextSend += SEND_INTERVAL_MS;
    if (WiFi.status() != WL_CONNECTED || !websocket.isConnected()) return;
    const uint32_t seq = ++sequenceNumber;
    String json = preparePayload(seq, enableAes);
    if (json.isEmpty()) return;
    bool sent = websocket.sendTXT(json);
    Serial.printf("WS seq=%lu sent=%d bytes=%u AES=%d\n", (unsigned long)seq, sent, (unsigned)json.length(), enableAes);
  }
}
