// Centralized hint utilities: emoji mapping and normalization

function hintEmoji(type) {
    switch ((type || '').toLowerCase()) {
        case 'text': return '🅣';
        case 'speech': return '💬';
        case 'audio': return '🔊';
        case 'video': return '🎥';
        case 'action': return '🎭';
        default: return '🅣';
    }
}

function normalizeGlobalHint(key, h) {
    const type = (h.type || 'text').toLowerCase();
    const emoji = hintEmoji(type);
    const target = h.target || h.mirror || 'Mirror';
    const displayText = h.description || h.text || h.file || key;
    return {
        id: key,
        type,
        emoji,
        target,
        displayText: `${emoji} ${target}: ${displayText}`,
        baseText: (h.text || h.description || h.file || String(key)).trim(),
        isEditable: type === 'text',
        data: h,
        text: h.text
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
                    target: 'Mirror',
                    displayText: `${hintEmoji('video')} Mirror: ${payload}`,
                    baseText: payload.trim(),
                    isEditable: false,
                    data: { type: 'video', file: payload, target: 'mirror' }
                };
            }
            if (action === 'playspeech') {
                return {
                    id: `gm-${idx}`,
                    type: 'speech',
                    emoji: hintEmoji('speech'),
                    target: 'Audio',
                    displayText: `${hintEmoji('speech')} Audio: ${payload}`,
                    baseText: payload.trim(),
                    isEditable: false,
                    data: { type: 'speech', file: payload, target: 'audio' }
                };
            }
            if (action === 'playaudiofx') {
                return {
                    id: `gm-${idx}`,
                    type: 'audio',
                    emoji: hintEmoji('audio'),
                    target: 'Audio',
                    displayText: `${hintEmoji('audio')} Audio: ${payload}`,
                    baseText: payload.trim(),
                    isEditable: false,
                    data: { type: 'audio', file: payload, target: 'audio' }
                };
            }
            const text = payload.trim();
            return {
                id: `gm-${idx}`,
                type: 'text',
                emoji: hintEmoji('text'),
                target: 'Mirror',
                displayText: `${hintEmoji('text')} Mirror: ${text}`,
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
            target: 'Mirror',
            displayText: `${hintEmoji('text')} Mirror: ${text}`,
            baseText: String(text).trim(),
            isEditable: true,
            text
        };
    }
    const id = h.id || `gm-${idx}`;
    const type = (h.type || 'text').toLowerCase();
    const emoji = hintEmoji(type);
    const target = h.target || h.mirror || 'Mirror';
    const displayText = h.description || h.text || h.file || id;
    return {
        id,
        type,
        emoji,
        target,
        displayText: `${emoji} ${target}: ${displayText}`,
        baseText: (h.text || h.description || h.file || String(id)).trim(),
        isEditable: type === 'text',
        data: h,
        text: h.text
    };
}

function getCombinedHints(cfg, gameHintsArray) {
    const out = [];
    const globalHintsObj = (cfg.global && cfg.global.media && cfg.global.media.hints) || {};

    if (Array.isArray(gameHintsArray)) {
        gameHintsArray.forEach((h, idx) => out.push(normalizeGameHint(idx, h)));
    }

    if (globalHintsObj && typeof globalHintsObj === 'object') {
        Object.keys(globalHintsObj).forEach(key => out.push(normalizeGlobalHint(key, globalHintsObj[key])));
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
