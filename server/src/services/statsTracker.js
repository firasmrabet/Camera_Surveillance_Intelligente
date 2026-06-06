/**
 * stats_tracker.js — Chap 14.2
 * =============================
 * Compteurs de production en mémoire (pas de DB) pour suivre en temps réel :
 *   - alertes émises / confirmées / rejetées
 *   - taux de fausses alertes
 *   - latence moyenne frame → alerte
 *   - uptime de l'engine IA
 *
 * Endpoint exposé : GET /api/stats
 * Les compteurs sont remis à zéro chaque jour à minuit.
 */

class StatsTracker {
  constructor() {
    this._alertsToday = 0;
    this._confirmed   = 0;
    this._dismissed   = 0;
    this._latencies   = [];  // rolling window des 100 dernières latences
    this._lastReset   = this._todayKey();
    this._engineStart = null;
  }

  _todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  _checkDailyReset() {
    const tk = this._todayKey();
    if (tk !== this._lastReset) {
      this._alertsToday = 0;
      this._confirmed   = 0;
      this._dismissed   = 0;
      this._lastReset   = tk;
    }
  }

  recordAlert(latencyMs = null) {
    this._checkDailyReset();
    this._alertsToday += 1;
    if (latencyMs !== null && Number.isFinite(latencyMs) && latencyMs >= 0) {
      this._latencies.push(latencyMs);
      if (this._latencies.length > 100) this._latencies.shift();
    }
  }

  recordConfirmed() {
    this._checkDailyReset();
    this._confirmed += 1;
  }

  recordDismissed() {
    this._checkDailyReset();
    this._dismissed += 1;
  }

  recordLatency(ms) {
    if (ms === null || !Number.isFinite(ms) || ms < 0) return;
    this._latencies.push(ms);
    if (this._latencies.length > 100) this._latencies.shift();
  }

  setEngineStarted() {
    this._engineStart = Date.now();
  }

  getSnapshot() {
    this._checkDailyReset();
    const total = this._confirmed + this._dismissed;
    const falseRate = total > 0 ? +(this._dismissed / total * 100).toFixed(1) : 0;
    const latencies = this._latencies;
    const avgLat = latencies.length
      ? +(latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(0)
      : 0;
    const p95Lat = latencies.length
      ? +([...latencies].sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)]).toFixed(0)
      : 0;
    return {
      alerts_today:      this._alertsToday,
      confirmed:         this._confirmed,
      dismissed:         this._dismissed,
      false_alarm_rate:  falseRate,
      avg_latency_ms:    avgLat,
      p95_latency_ms:    p95Lat,
      latency_samples:   latencies.length,
      engine_uptime_s:   this._engineStart ? Math.floor((Date.now() - this._engineStart) / 1000) : null,
      date:              this._lastReset,
      last_updated:      new Date().toISOString(),
    };
  }
}

module.exports = new StatsTracker();
