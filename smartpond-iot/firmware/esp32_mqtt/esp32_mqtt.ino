#define NODE_ID "mqtt-01"
#define NODE_PROTOCOL "MQTT"
#include "SmartPondShared.h"
#include <PubSubClient.h>

WiFiClient net;
PubSubClient mqtt(net);
uint32_t nextSend = 0;

void connectMqtt() {
  if (WiFi.status() != WL_CONNECTED || mqtt.connected()) return;
  static uint32_t nextRetry = 0;
  if (static_cast<int32_t>(millis() - nextRetry) < 0) return;
  nextRetry = millis() + 3000;
  if (mqtt.connect(NODE_ID, MQTT_USER, MQTT_PASSWORD)) {
    Serial.println("MQTT connected");
  } else {
    Serial.printf("MQTT state=%d\n", mqtt.state());
  }
}

void setup() {
  initShared();
  mqtt.setServer(SERVER_IP, MQTT_PORT);
  mqtt.setBufferSize(2048);
  nextSend = millis() + SEND_INTERVAL_MS;
}

void loop() {
  handleSerialMode();
  ensureWifi();
  connectMqtt();
  mqtt.loop();
  if (static_cast<int32_t>(millis() - nextSend) >= 0) {
    nextSend += SEND_INTERVAL_MS;
    if (!mqtt.connected()) return;
    const uint32_t seq = ++sequenceNumber;
    String json = preparePayload(seq, enableAes);
    if (json.length() == 0) return;
    bool published = mqtt.publish("pond/mqtt-01/telemetry", json.c_str(), false);
    Serial.printf("MQTT seq=%lu published=%d bytes=%u AES=%d\n", (unsigned long)seq, published, (unsigned)json.length(), enableAes);
  }
}
