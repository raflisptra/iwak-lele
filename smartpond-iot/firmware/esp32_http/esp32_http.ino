#define NODE_ID "http-01"
#define NODE_PROTOCOL "HTTP"
#include "SmartPondShared.h"
#include <HTTPClient.h>

uint32_t nextSend = 0;

void setup() {
  initShared();
  nextSend = millis() + SEND_INTERVAL_MS;
}

void loop() {
  handleSerialMode();
  ensureWifi();
  if (static_cast<int32_t>(millis() - nextSend) >= 0) {
    nextSend += SEND_INTERVAL_MS;
    if (WiFi.status() != WL_CONNECTED) return;
    const uint32_t seq = ++sequenceNumber;
    String json = preparePayload(seq, enableAes);
    if (json.isEmpty()) return;
    WiFiClient net;
    HTTPClient http;
    String url = String("http://") + SERVER_IP + ":" + String(SERVER_PORT) + "/ingest/http";
    http.setTimeout(3000);
    if (!http.begin(net, url)) {
      Serial.println("HTTP begin failed");
      return;
    }
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Token", DEVICE_TOKEN);
    uint32_t startedAt = millis();
    int status = http.POST(json);
    Serial.printf("HTTP seq=%lu code=%d bytes=%u RTT=%lums AES=%d\n",
      (unsigned long)seq, status, (unsigned)json.length(),
      (unsigned long)(millis() - startedAt), enableAes);
    http.end();
  }
}
