const { buildVerifyMediaOptions, VERIFY_MEDIA_TIMEOUT_MS } = require('../src/engineUtils');

describe('buildVerifyMediaOptions', () => {
    test('infers media types from filenames and preserves overrides', () => {
        const imageOptions = buildVerifyMediaOptions({ file: 'still.PNG' });
        expect(imageOptions.image).toBe('still.PNG');
        expect(imageOptions.video).toBeUndefined();
        expect(imageOptions.background).toBeUndefined();

        const videoOptions = buildVerifyMediaOptions({ file: 'intro_short.mp4' });
        expect(videoOptions.video).toBe('intro_short.mp4');
        expect(videoOptions.image).toBeUndefined();
        expect(videoOptions.background).toBeUndefined();

        const bgOptions = buildVerifyMediaOptions({ file: 'music.mp3' });
        expect(bgOptions.background).toBe('music.mp3');
        expect(bgOptions.image).toBeUndefined();
        expect(bgOptions.video).toBeUndefined();

        const overrideOptions = buildVerifyMediaOptions({ file: 'intro_short.mp4', image: 'poster.png' });
        expect(overrideOptions.image).toBe('poster.png');
        expect(overrideOptions.video).toBeUndefined();
    });

    test('normalizes dashed keys and preserves timeout', () => {
        const complex = buildVerifyMediaOptions({
            file: 'black_screen.png',
            'zone-volume': 55,
            timeout: VERIFY_MEDIA_TIMEOUT_MS
        });

        expect(complex.image).toBe('black_screen.png');
        expect(complex.zoneVolume).toBe(55);
        expect(complex.timeout).toBe(VERIFY_MEDIA_TIMEOUT_MS);
    });
});
