// Centralized hint utilities: emoji mapping and normalization

function hintEmoji(type) {
    switch ((type || '').toLowerCase()) {
        case 'text': return '🅣';
        case 'sequence': return '🪄';
        case 'speech': return '💬';
        case 'audiofx': return '🔊';
        case 'background': return '🎵';
        case 'video': return '🎥';
        case 'image': return '🖼️';
        case 'action': return '🎭';
        default: return '🅣';
    }
}

function normalizeType(type) {
    const value = String(type || 'text').toLowerCase();
    if (value === 'audiofx') return 'audioFx';
    return value;
}

function toDisplayLabel(emoji, type, zone, description) {
    const zonePart = zone ? ` ${zone}` : '';
    return `${emoji} ${type}${zonePart}: ${description}`;
}

function normalizeGlobalHint(key, h) {
    const type = normalizeType(h.type || 'text');
    const emoji = hintEmoji(type);
    const zone = typeof h.zone === 'string' ? h.zone.trim() : '';
    const description = (h.description || h.text || h.file || key || '').toString().trim();
    return {
        id: key,
        type,
        emoji,
        zone,
        target: zone,
        description,
        displayText: toDisplayLabel(emoji, type, zone, description),
        baseText: (type === 'text' ? (h.text || h.description || '') : (h.description || h.file || h.text || String(key))).toString().trim(),
        isEditable: type === 'text',
        data: h,
        text: h.text,
        duration: h.duration
    };
}

function normalizeGameHint(idx, h) {
    if (typeof h === 'string') {
        const shorthandMatch = h.match(/^([a-zA-Z]+):(.*)$/);
        if (shorthandMatch) {
            const action = shorthandMatch[1].toLowerCase();
            const payload = shorthandMatch[2];
            if (action === 'playvideo') {
                return {
                    id: `gm-${idx}`,
                    type: 'video',
                    emoji: hintEmoji('video'),
                    zone: '',
                    target: '',
                    description: payload,
                    displayText: toDisplayLabel(hintEmoji('video'), 'video', '', payload),
                    baseText: payload.trim(),
                    isEditable: false,
                    data: { type: 'video', file: payload, target: '' }
                };
            }
            if (action === 'playspeech') {
                return {
                    id: `gm-${idx}`,
                    type: 'speech',
                    emoji: hintEmoji('speech'),
                    zone: '',
                    target: '',
                    description: payload,
                    displayText: toDisplayLabel(hintEmoji('speech'), 'speech', '', payload),
                    baseText: payload.trim(),
                    isEditable: false,
                    data: { type: 'speech', file: payload, target: '' }
                };
            }
            if (action === 'playaudiofx') {
                return {
                    id: `gm-${idx}`,
                    type: 'audioFx',
                    emoji: hintEmoji('audioFx'),
                    zone: '',
                    target: '',
                    description: payload,
                    displayText: toDisplayLabel(hintEmoji('audioFx'), 'audioFx', '', payload),
                    baseText: payload.trim(),
                    isEditable: false,
                    data: { type: 'audioFx', file: payload, target: '' }
                };
            }
            if (action === 'playbackground') {
                return {
                    id: `gm-${idx}`,
                    type: 'background',
                    emoji: hintEmoji('background'),
                    zone: '',
                    target: '',
                    description: payload,
                    displayText: toDisplayLabel(hintEmoji('background'), 'background', '', payload),
                    baseText: payload.trim(),
                    isEditable: false,
                    data: { type: 'background', file: payload, target: '' }
                };
            }
            if (action === 'setimage') {
                return {
                    id: `gm-${idx}`,
                    type: 'image',
                    emoji: hintEmoji('image'),
                    zone: '',
                    target: '',
                    description: payload,
                    displayText: toDisplayLabel(hintEmoji('image'), 'image', '', payload),
                    baseText: payload.trim(),
                    isEditable: false,
                    data: { type: 'image', file: payload, target: '' }
                };
            }
            const text = payload.trim();
            return {
                id: `gm-${idx}`,
                type: 'text',
                emoji: hintEmoji('text'),
                zone: '',
                target: '',
                description: text,
                displayText: toDisplayLabel(hintEmoji('text'), 'text', '', text),
                baseText: text,
                isEditable: true,
                text
            };
        }
        const text = h;
        return {
            id: `gm-${idx}`,
            type: 'text',
            emoji: hintEmoji('text'),
            zone: '',
            target: '',
            description: String(text).trim(),
            displayText: toDisplayLabel(hintEmoji('text'), 'text', '', text),
            baseText: String(text).trim(),
            isEditable: true,
            text
        };
    }
    const id = h.id || `gm-${idx}`;
    const type = normalizeType(h.type || 'text');
    const emoji = hintEmoji(type);
    const zone = typeof h.zone === 'string' ? h.zone.trim() : '';
    const description = (h.description || h.text || h.file || id || '').toString().trim();
    return {
        id,
        type,
        emoji,
        zone,
        target: zone,
        description,
        displayText: toDisplayLabel(emoji, type, zone, description),
        baseText: (type === 'text' ? (h.text || h.description || '') : (h.description || h.file || h.text || String(id))).toString().trim(),
        isEditable: type === 'text',
        data: h,
        text: h.text,
        duration: h.duration
    };
}

function getCombinedHints(cfg, gameHintsArray) {
    const out = [];
    // Canonical source of global hint definitions
    const globalHintsObj = (cfg.global && cfg.global.hints) || {};
    const referencedGlobalIds = new Set();
    const overriddenGlobalIds = new Set();

    if (Array.isArray(gameHintsArray)) {
        gameHintsArray.forEach((h, idx) => {
            // If a game-mode hint is a string that matches a global hint id,
            // treat it as an explicit reference instead of plain text.
            if (typeof h === 'string') {
                const trimmed = h.trim();
                if (trimmed && globalHintsObj && Object.prototype.hasOwnProperty.call(globalHintsObj, trimmed)) {
                    out.push(normalizeGlobalHint(trimmed, globalHintsObj[trimmed]));
                    referencedGlobalIds.add(trimmed);
                    return;
                }
            }

            const normalized = normalizeGameHint(idx, h);

            // Mode-local object hints with matching ids override global hints for this mode.
            if (h && typeof h === 'object' && typeof normalized.id === 'string' && normalized.id.trim()) {
                if (Object.prototype.hasOwnProperty.call(globalHintsObj, normalized.id)) {
                    overriddenGlobalIds.add(normalized.id);
                }
            }

            out.push(normalized);
        });
    }

    if (globalHintsObj && typeof globalHintsObj === 'object') {
        Object.keys(globalHintsObj).forEach(key => {
            if (!referencedGlobalIds.has(key) && !overriddenGlobalIds.has(key)) {
                out.push(normalizeGlobalHint(key, globalHintsObj[key]));
            }
        });
    }

    const seen = new Set();
    const dedup = [];
    out.forEach(it => {
        const key = (it.baseText || it.displayText || '').toString().toLowerCase().trim();
        if (!seen.has(key)) {
            seen.add(key);
            dedup.push(it);
        }
    });
    return dedup;
}

module.exports = {
    hintEmoji,
    normalizeGlobalHint,
    normalizeGameHint,
    getCombinedHints,
};
