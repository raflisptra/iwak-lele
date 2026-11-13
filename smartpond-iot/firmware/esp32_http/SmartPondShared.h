#pragma once

// Smart Pond: sensor real mode based on team's original sketch.
// ESP32 classic (WROOM/DevKit); Arduino-ESP32 3.x; ArduinoJson 7.x.
// Copy secrets.example.h -> secrets.h in EACH sketch folder.
#include <Arduino.h>
#include <WiFi.h>
#include <time.h>
#include <ArduinoJson.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <mbedtls/gcm.h>
#include <esp_system.h>
#include <math.h>
#include <vector>
#include "secrets.h"

#ifndef NODE_ID
#error NODE_ID must be defined before SmartPondShared.h
#endif
#ifndef NODE_PROTOCOL
#error NODE_PROTOCOL must be defined before SmartPondShared.h
#endif

// As in the team's original DS18B20/pH-4502C/water-level sketch.
constexpr int TEMP_GPIO  = 4;
constexpr int PH_GPIO    = 34;  // ESP32 classic ADC1: Wi-Fi-safe
constexpr int WATER_GPIO = 35;  // ESP32 classic ADC1: Wi-Fi-safe
static OneWire oneWire(TEMP_GPIO);
static DallasTemperature tempSensors(&oneWire);
static uint32_t sequenceNumber = 0;
static String bootId;
static bool enableAes = DEFAULT_USE_AES;
static bool ntpStarted = false;

struct SensorReadings {
  float temperature;
  float ph;
  float water;
};

static String toHex(const uint8_t *bytes, size_t count) {
  const char *digits = "0123456789abcdef";
  String output;
  output.reserve(count * 2);
  for (size_t i = 0; i < count; ++i) {
    output += digits[bytes[i] >> 4];
    output += digits[bytes[i] & 0x0f];
  }
  return output;
}
static bool fromHex(const char *hex, uint8_t *output, size_t n) {
  if (strlen(hex) != n * 2) return false;
  for (size_t i = 0; i < n; ++i) {
    char a = hex[i * 2], b = hex[i * 2 + 1];
    auto nibble = [](char c) -> int {
      if (c >= '0' && c <= '9') return c - '0';
      if (c >= 'a' && c <= 'f') return c - 'a' + 10;
      if (c >= 'A' && c <= 'F') return c - 'A' + 10;
      return -1;
    };
    int hi = nibble(a), lo = nibble(b);
    if (hi < 0 || lo < 0) return false;
    output[i] = (hi << 4) | lo;
  }
  return true;
}

// Uses the same single analogRead() and formula as the team's original sketch.
// WARNING: pH and water percent are INDICATIVE until physically calibrated.
static SensorReadings readSensors(uint32_t seq) {
#if SIMULATE_SENSORS
  return {27.8f + 0.1f * (seq % 5), 6.9f + 0.05f * (seq % 5), 62.0f + (seq % 5)};
#else
  // 1) DS18B20: GPIO 4, 4.7k pull-up between DATA and 3.3V.
  tempSensors.requestTemperatures();
  float temperatureC = tempSensors.getTempCByIndex(0);
  if (temperatureC == DEVICE_DISCONNECTED_C ||
      !isfinite(temperatureC) || temperatureC < -55.0f || temperatureC > 125.0f) {
    temperatureC = NAN;
  }

  // 2) pH-4502C: GPIO 34. Preserve original approximation:
  // phVoltage = phRaw * (3.3 / 4095)
  // phValue = 7 - ((phVoltage - voltAtPh7) * slope)
  const int phRaw = analogRead(PH_GPIO);
  const float phVoltage = phRaw * (3.3f / 4095.0f);
  float phValue = 7.0f - ((phVoltage - PH_VOLT_AT_PH7) * PH_SLOPE);
  if (!isfinite(phValue) || phValue < 0.0f || phValue > 14.0f) phValue = NAN;

  // 3) Analog water-level: GPIO 35. Preserve map raw->percent and clamp.
  const int waterRaw = analogRead(WATER_GPIO);
  float waterPercent = NAN;
  if (WATER_RAW_MAX > WATER_RAW_MIN) {
    // A reading pinned at ADC=4095 was previously observed on this project.
    // Do not silently report 100% if the ADC has saturated.
    if (INVALIDATE_SATURATED_WATER && waterRaw >= 4090) {
      Serial.println("WARN: water-level ADC saturated (raw near 4095); check sensor/voltage/cabling");
    } else {
      const long mapped = map(waterRaw, WATER_RAW_MIN, WATER_RAW_MAX, 0, 100);
      waterPercent = constrain((float)mapped, 0.0f, 100.0f);
    }
  }

  Serial.printf("SENSOR phRaw=%d phV=%.3f waterRaw=%d -> temp=%.2f ph=%.2f level=%.1f%%\n",
    phRaw, phVoltage, waterRaw, temperatureC, phValue, waterPercent);
  return {temperatureC, phValue, waterPercent};
#endif
}

static void writeData(JsonObject data, const SensorReadings &s) {
  // API & SQLite expect 'ph' and 'water_level_pct' (NOT 'ph_value'/'water_level_percent').
  if (isfinite(s.temperature)) data["temperature_c"] = roundf(s.temperature * 100) / 100.0f;
  else data["temperature_c"] = nullptr;
  if (isfinite(s.ph)) data["ph"] = roundf(s.ph * 100) / 100.0f;
  else data["ph"] = nullptr;
  if (isfinite(s.water)) data["water_level_pct"] = roundf(s.water * 100) / 100.0f;
  else data["water_level_pct"] = nullptr;
}

static String deviceLocalTimestamp() {
  struct tm info;
  // Never block sending while NTP is unavailable.
  if (!getLocalTime(&info, 0) || info.tm_year + 1900 < 2024) return "";
  char timestamp[32];
  if (!strftime(timestamp, sizeof(timestamp), "%Y-%m-%dT%H:%M:%S", &info)) return "";
  return String(timestamp) + "+07:00"; // WIB (+07:00), not UTC
}

static String preparePayload(uint32_t seq, bool aes) {
  SensorReadings readings = readSensors(seq);
  JsonDocument envelope;
  envelope["node_id"] = NODE_ID;
  envelope["protocol"] = NODE_PROTOCOL;
  envelope["boot_id"] = bootId;
  envelope["seq"] = seq;
  envelope["encrypted"] = aes;
  String timestamp = deviceLocalTimestamp();
  if (timestamp.length()) envelope["timestamp"] = timestamp;
  else envelope["timestamp"] = nullptr; // NTP not yet synchronized

  if (!aes) {
    JsonObject obj = envelope["data"].to<JsonObject>();
    writeData(obj, readings);
  } else {
    uint8_t key[32];
    if (!fromHex(AES_KEY_HEX, key, sizeof(key))) {
      Serial.println("ERROR: AES_KEY_HEX must contain exactly 64 hexadecimal characters");
      return "";
    }
    JsonDocument data;
    writeData(data.to<JsonObject>(), readings);
    String plaintext;
    serializeJson(data, plaintext);
    String aad = String(NODE_ID) + "|" + NODE_PROTOCOL + "|" + bootId + "|" + String(seq);
    uint8_t iv[12], tag[16];
    esp_fill_random(iv, sizeof(iv));
    std::vector<uint8_t> cipher(plaintext.length());
    mbedtls_gcm_context context;
    mbedtls_gcm_init(&context);
    int rc = mbedtls_gcm_setkey(&context, MBEDTLS_CIPHER_ID_AES, key, 256);
    if (rc == 0) {
      rc = mbedtls_gcm_crypt_and_tag(
        &context, MBEDTLS_GCM_ENCRYPT, plaintext.length(),
        iv, sizeof(iv),
        reinterpret_cast<const unsigned char*>(aad.c_str()), aad.length(),
        reinterpret_cast<const unsigned char*>(plaintext.c_str()),
        cipher.data(), sizeof(tag), tag
      );
    }
    mbedtls_gcm_free(&context);
    if (rc != 0) {
      Serial.printf("AES encrypt failed: %d\n", rc);
      return "";
    }
    envelope["iv"] = toHex(iv, sizeof(iv));
    envelope["tag"] = toHex(tag, sizeof(tag));
    envelope["ciphertext"] = toHex(cipher.data(), cipher.size());
  }
  String result;
  serializeJson(envelope, result);
  return result;
}

static void initShared() {
  Serial.begin(115200);
  delay(400);
  uint8_t idBytes[8];
  esp_fill_random(idBytes, sizeof(idBytes));
  bootId = toHex(idBytes, sizeof(idBytes));
  tempSensors.begin();
  analogReadResolution(12);
  analogSetPinAttenuation(PH_GPIO, ADC_11db);
  analogSetPinAttenuation(WATER_GPIO, ADC_11db);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("Node=%s, boot=%s, protocol=%s\n", NODE_ID, bootId.c_str(), NODE_PROTOCOL);
  Serial.println("REAL SENSORS: GPIO4=DS18B20, GPIO34=pH, GPIO35=level");
  Serial.println("Serial '1' = enable AES; '0' = disable AES");
}
static void handleSerialMode() {
  while (Serial.available()) {
    char mode = Serial.read();
    if (mode == '1' || mode == '0') {
      enableAes = mode == '1';
      Serial.printf("AES-256-GCM: %s\n", enableAes ? "ON" : "OFF");
    }
  }
}
static void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!ntpStarted) {
      configTime(25200, 0, "pool.ntp.org"); // WIB (GMT+7); non-blocking
      ntpStarted = true;
      Serial.print("WiFi connected. IP=");
      Serial.println(WiFi.localIP());
    }
    return;
  }
  static uint32_t retryAt = 0;
  if (static_cast<int32_t>(millis() - retryAt) >= 0) {
    Serial.println("WiFi disconnected; retrying...");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    retryAt = millis() + 10000;
  }
}
