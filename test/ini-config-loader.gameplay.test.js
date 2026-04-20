const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadIniConfig } = require('../src/ini-config-loader');

describe('INI loader gameplay logging fields', () => {
    test('parses gameplay logging and chat topic fields', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxo-ini-'));
        const iniPath = path.join(tmpDir, 'pxo.ini');

        fs.writeFileSync(iniPath, [
            '[global]',
            'game_logging=on',
            'game_log_path=/tmp/pxo-gameplay',
            'chat_to_player=paradox/test/chat/to-player',
            'chat_from_player=paradox/test/chat/from-player',
            '[mqtt]',
            'broker=localhost',
            'port=1883'
        ].join('\n'));

        const cfg = loadIniConfig(iniPath);

        expect(cfg.global.game_logging).toBe(true);
        expect(cfg.global.game_log_path).toBe('/tmp/pxo-gameplay');
        expect(cfg.global.chat_to_player).toBe('paradox/test/chat/to-player');
        expect(cfg.global.chat_from_player).toBe('paradox/test/chat/from-player');
        expect(cfg.mqtt.broker).toBe('mqtt://localhost:1883');
    });

    test('defaults gameplay logging fields when ini file is missing', () => {
        const missingPath = path.join(os.tmpdir(), 'pxo-ini-does-not-exist.ini');
        const cfg = loadIniConfig(missingPath);

        expect(cfg.global.game_logging).toBe(false);
        expect(cfg.global.game_log_path).toBe(null);
        expect(cfg.global.chat_to_player).toBe(null);
        expect(cfg.global.chat_from_player).toBe(null);
    });
});
