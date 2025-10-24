const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const { buildVerifyMediaOptions, VERIFY_MEDIA_TIMEOUT_MS } = require('../src/engineUtils');

(function run() {
    // Defaults image when file is png
    const imageOptions = buildVerifyMediaOptions({ file: 'still.PNG' });
    assert(imageOptions.image === 'still.PNG', 'PNG file should map to image');
    assert(!imageOptions.video && imageOptions.background === undefined, 'PNG file should not set video/background');

    // Defaults video when file is mp4
    const videoOptions = buildVerifyMediaOptions({ file: 'intro_short.mp4' });
    assert(videoOptions.video === 'intro_short.mp4', 'MP4 file should map to video');
    assert(!videoOptions.image && videoOptions.background === undefined, 'MP4 file should not set image/background');

    // Defaults background when file is mp3
    const bgOptions = buildVerifyMediaOptions({ file: 'music.mp3' });
    assert(bgOptions.background === 'music.mp3', 'MP3 file should map to background');
    assert(!bgOptions.image && !bgOptions.video, 'MP3 should not set image/video');

    // Respects explicit overrides
    const overrideOptions = buildVerifyMediaOptions({ file: 'intro_short.mp4', image: 'poster.png' });
    assert(overrideOptions.image === 'poster.png', 'Explicit image should take precedence');
    assert(!overrideOptions.video, 'Explicit image should prevent inferred video');

    // Accepts dashed volume keys and default timeout injection from callers
    const complex = buildVerifyMediaOptions({ file: 'black_screen.png', 'zone-volume': 55, timeout: VERIFY_MEDIA_TIMEOUT_MS });
    assert(complex.image === 'black_screen.png', 'PNG file should map to image even with dashed keys');
    assert(complex.zoneVolume === 55, 'zone-volume should normalize to zoneVolume');
    assert(complex.timeout === VERIFY_MEDIA_TIMEOUT_MS, 'timeout should pass through');

    console.log('engineUtils.verifyImage.test.js PASS');
})();
