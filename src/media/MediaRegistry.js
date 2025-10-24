const PfxAdapter = require('../adapters/pfx');
const log = require('../logger');

// Infer basic capabilities when not provided in config
function inferCapabilities(id = '') {
  const name = String(id).toLowerCase();
  if (name.includes('audio')) {
    return ['speech', 'background-audio', 'audio-fx'];
  }
  // default to screen/display capabilities
  return ['video', 'image', 'browser', 'speech', 'background-audio'];
}

class MediaRegistry {
  constructor(mqtt, mediaPlayersConfig = {}) {
    this.mqtt = mqtt;
    this.players = {}; // id -> adapter
    this.eventTopics = {}; // id -> events topic

    Object.entries(mediaPlayersConfig).forEach(([id, cfg]) => {
      if (!cfg || !cfg.baseTopic) {
        log.warn(`MediaRegistry: skipping '${id}' – missing baseTopic`);
        return;
      }
      const adapter = new PfxAdapter(mqtt, cfg);
      adapter.id = id;
      adapter.capabilities = Array.isArray(cfg.capabilities) && cfg.capabilities.length
        ? cfg.capabilities.slice()
        : inferCapabilities(id);
      this.players[id] = adapter;
      this.eventTopics[id] = `${cfg.baseTopic}/events`;
    });
  }

  get(id) { return this.players[id]; }
  getAll() { return Object.values(this.players); }
  ids() { return Object.keys(this.players); }

  getAllEventTopics() { return Object.values(this.eventTopics); }
  getEventTopicToIdMap() { return { ...Object.fromEntries(Object.entries(this.eventTopics).map(([id, t]) => [t, id])) }; }

  cleanup() {
    this.getAll().forEach(p => { try { p.cleanup && p.cleanup(); } catch (e) { } });
  }
}

module.exports = MediaRegistry;
