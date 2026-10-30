-- Skema database untuk proyek PBL monitoring kolam lele.
-- Jalankan file ini ketika pgAdmin sudah terhubung ke database monitoring_lele.
-- File ini hanya membuat struktur tabel; tidak ada INSERT atau data dummy.

CREATE TABLE IF NOT EXISTS test_scenarios (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    scenario_code TEXT NOT NULL UNIQUE,
    scenario_name TEXT NOT NULL,
    description TEXT,
    latency_ms NUMERIC CHECK (latency_ms IS NULL OR latency_ms >= 0),
    packet_loss_percent NUMERIC CHECK (
        packet_loss_percent IS NULL OR
        (packet_loss_percent >= 0 AND packet_loss_percent <= 100)
    ),
    bandwidth_kbps NUMERIC CHECK (bandwidth_kbps IS NULL OR bandwidth_kbps >= 0),
    aes_enabled BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sensor_readings (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id TEXT NOT NULL,
    temperature_c DOUBLE PRECISION NOT NULL,
    ph_value DOUBLE PRECISION NOT NULL,
    water_level_cm DOUBLE PRECISION NOT NULL,
    sensor_timestamp TIMESTAMPTZ,
    received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    protocol TEXT NOT NULL CHECK (protocol IN ('HTTP', 'MQTT', 'WebSocket')),
    scenario_id BIGINT REFERENCES test_scenarios(id) ON DELETE SET NULL,
    raw_payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sensor_readings_received_at
    ON sensor_readings (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_sensor_readings_protocol
    ON sensor_readings (protocol);

CREATE INDEX IF NOT EXISTS idx_sensor_readings_scenario_id
    ON sensor_readings (scenario_id);

-- Tabel ini disediakan untuk menyimpan hasil analisis PCAP setelah pengujian.
-- Backend sensor saat ini tidak menghitung metrik QoS secara otomatis.
CREATE TABLE IF NOT EXISTS qos_results (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    scenario_id BIGINT NOT NULL REFERENCES test_scenarios(id) ON DELETE CASCADE,
    protocol TEXT NOT NULL CHECK (protocol IN ('HTTP', 'MQTT', 'WebSocket')),
    throughput_kbps DOUBLE PRECISION CHECK (throughput_kbps IS NULL OR throughput_kbps >= 0),
    delay_ms DOUBLE PRECISION CHECK (delay_ms IS NULL OR delay_ms >= 0),
    jitter_ms DOUBLE PRECISION CHECK (jitter_ms IS NULL OR jitter_ms >= 0),
    packet_loss_percent DOUBLE PRECISION CHECK (
        packet_loss_percent IS NULL OR
        (packet_loss_percent >= 0 AND packet_loss_percent <= 100)
    ),
    response_time_ms DOUBLE PRECISION CHECK (response_time_ms IS NULL OR response_time_ms >= 0),
    goodput_kbps DOUBLE PRECISION CHECK (goodput_kbps IS NULL OR goodput_kbps >= 0),
    protocol_overhead_bytes BIGINT CHECK (protocol_overhead_bytes IS NULL OR protocol_overhead_bytes >= 0),
    pcap_file_name TEXT,
    notes TEXT,
    analyzed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_qos_results_scenario_protocol
    ON qos_results (scenario_id, protocol);
