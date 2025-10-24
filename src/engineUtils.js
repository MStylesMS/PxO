// Shared engine utilities for state machine and sequence runner
// (Inference removed) path dependency no longer required

// Base game topic (no fallback default here to avoid surprising callers)
const getGameTopic = (cfg) => cfg?.global?.mqtt?.['game-topic'] || null;

// Standard UI topics (preserves game.js behavior by defaulting when missing)
const getUiTopics = (cfg) => {
    const base = getGameTopic(cfg) || 'paradox/houdini';
    return {
        commands: `${base}/commands`,
        hint: `${base}/hints`,
        state: `${base}/state`,
        events: `${base}/events`,
        warnings: `${base}/warnings`,
        hintsRegistry: `${base}/hints/registry`,
        config: `${base}/config`,
    };
};

// Canonical individual topics
const getCommandsTopic = (cfg) => {
    const gameTopic = getGameTopic(cfg);
    return gameTopic ? `${gameTopic}/commands` : null;
};
const getEventsTopic = (cfg) => {
    const gameTopic = getGameTopic(cfg);
    return gameTopic ? `${gameTopic}/events` : null;
};
const getWarningsTopic = (cfg) => {
    const gameTopic = getGameTopic(cfg);
    return gameTopic ? `${gameTopic}/warnings` : null;
};

// Publish executeHint command to the game commands topic
const publishExecuteHint = (mqtt, cfg, id, source = 'utils') => {
    if (!id) return { ok: false, error: 'missing_id' };
    const topic = getCommandsTopic(cfg);
    if (!mqtt || !topic) return { ok: false, error: 'no_topic' };
    try {
        mqtt.publish(topic, { command: 'executeHint', id });
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
};

// stopAllAcrossZones: stop background, video, and speech media across all media zones.
// (Renamed from stopAllMediaAcrossZones after deprecating legacy stopAllMedia command name)
// Avoid dispatching stop* to non-media adapters (e.g., lights/clock) to reduce log noise.
// Swallow rejections to avoid unhandled promise rejections.
const stopAllAcrossZones = (zonesRegistry) => {
    if (!zonesRegistry) return;
    const swallow = (p) => { try { Promise.resolve(p).catch(() => { /* ignore */ }); } catch (_) { /* ignore sync errors */ } };

    // Prefer explicit media zone discovery when supported
    let mediaZoneNames = [];
    try {
        if (typeof zonesRegistry.getZonesByType === 'function') {
            const entries = zonesRegistry.getZonesByType('pfx-media') || [];
            mediaZoneNames = entries.map(e => e.zoneName).filter(Boolean);
        }
    } catch (_) { /* ignore */ }

    // Fallback: filter all zones by capability if type-based query isn't available
    if (mediaZoneNames.length === 0 && typeof zonesRegistry.getZoneNames === 'function') {
        const allZones = zonesRegistry.getZoneNames();
        if (Array.isArray(allZones)) {
            mediaZoneNames = allZones.filter(z => {
                try {
                    // Heuristic: a media zone can execute at least one of these
                    return (typeof zonesRegistry.canExecute === 'function'
                        && (zonesRegistry.canExecute(z, 'stopVideo')
                            || zonesRegistry.canExecute(z, 'stopBackground')
                            || zonesRegistry.canExecute(z, 'stopSpeech')));
                } catch (_) { return false; }
            });
        }
    }

    // As last resort, if we couldn't determine, do nothing to avoid noisy logs
    if (!Array.isArray(mediaZoneNames) || mediaZoneNames.length === 0) return;

    mediaZoneNames.forEach(z => {
        swallow(zonesRegistry.execute(z, 'stopBackground', {}));
        swallow(zonesRegistry.execute(z, 'stopVideo', {}));
        swallow(zonesRegistry.execute(z, 'stopSpeech', {}));
    });
};

// Standard verification timeout constants (ms)
const VERIFY_BROWSER_TIMEOUT_MS = 20000;
const VERIFY_MEDIA_TIMEOUT_MS = 15000;

module.exports = {
    getGameTopic,
    getUiTopics,
    getCommandsTopic,
    getEventsTopic,
    getWarningsTopic,
    publishExecuteHint,
    stopAllAcrossZones,
    VERIFY_BROWSER_TIMEOUT_MS,
    VERIFY_MEDIA_TIMEOUT_MS,
};