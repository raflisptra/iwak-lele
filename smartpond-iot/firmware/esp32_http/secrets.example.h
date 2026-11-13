#pragma once
// Copy to secrets.h in EACH ESP32 sketch folder.
// Do not place real credentials in source-control or shared ZIP files.
#define WIFI_SSID "ISI_SSID_WIFI"
#define WIFI_PASSWORD "ISI_PASSWORD_WIFI"
#define SERVER_IP "192.168.50.10"  // CHANGE to your Ubuntu server LAN IP
#define SERVER_PORT 3000
#define MQTT_PORT 1883
#define MQTT_USER "pbllele"
#define MQTT_PASSWORD "ISI_PASSWORD_AKUN_PBLLELE"
#define DEVICE_TOKEN "ISI_DEVICE_TOKEN_DARI_SERVER_ENV"
#define AES_KEY_HEX "ISI_KEY_AES_64_KARAKTER_HEX_DARI_ENV"

// K1: real sensor, AES OFF, no impairment.
#define SIMULATE_SENSORS 0
#define DEFAULT_USE_AES false
#define SEND_INTERVAL_MS 5000UL

// Same provisional sensor formula as the team's ORIGINAL working sketch.
// These are not scientific pH/water-depth calibrations; adjust using measurements.
#define PH_VOLT_AT_PH7 2.40f  // voltage at pH=7 (ORIGINAL assumption)
#define PH_SLOPE 1.00f        // pH units per volt (ORIGINAL assumption)
#define WATER_RAW_MIN 0       // ADC when dry (ORIGINAL assumption)
#define WATER_RAW_MAX 2500    // ADC at maximum reference (ORIGINAL assumption)
#define INVALIDATE_SATURATED_WATER 1  // raw >=4090 => null (safety diagnostic)
