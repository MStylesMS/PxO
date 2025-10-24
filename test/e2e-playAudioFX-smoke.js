/* End-to-end-ish smoke test: ensure a scheduled cue with playAudioFX publishes correct MQTT payload.
 * This is a lightweight harness that stubs MQTT client publish and inspects MQTT messages for the audio zone.
 */
const { loadConfig } = require('../src/config');
const GameStateMachine = require('../src/stateMachine');

function stubMqtt() {
  const published = [];
  return {
    _published: published,
    publish(topic, payload) { published.push({ topic, payload }); },
    subscribe() { },
    on() { }
  };
}

function stubClock() { return { command: () => { }, setTime: () => { }, fadeIn: () => { }, fadeOut: () => { }, hint: () => { }, start: () => { }, pause: () => { }, resume: () => { } }; }
function stubLights() { return { scene: () => { } }; }

// Unified media stub kept for constructor signature compatibility; state machine uses zone adapters instead.
function makeUnifiedMedia() { return {}; }

function assert(cond, msg) { if (!cond) throw new Error(msg); }

(async function run() {
  const cfg = loadConfig();
  const mqtt = stubMqtt();
  const clock = stubClock();
  const lights = stubLights();
  const media = makeUnifiedMedia();
  const sm = new GameStateMachine({ cfg, mqtt, clock, lights, media });
  sm.init();
  if (sm.stopHeartbeat) sm.stopHeartbeat();

  // Wait for reset-sequence completion before starting demo mode
  async function waitForReady(timeoutMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (sm.state === 'ready' && !sm._runningSequence) return true;
      await new Promise(r => setTimeout(r, 50));
    }
    return false;
  }

  const readyOk = await waitForReady();
  assert(readyOk, 'State machine did not reach ready state in time');

  // Choose a short mode (hc-demo) using generic startMode command because schedule is short and contains braam cues
  await sm.handleCommand({ command: 'startMode', mode: 'hc-demo' });
  // Ensure schedule loaded
  assert(sm.gameType === 'hc-demo', 'Expected hc-demo gameType');

  // Find hugeBraam entry at 60s remaining (per current demo schedule)
  // We'll just set remaining then invoke checkSchedule
  sm.state = 'gameplay';
  sm.remaining = 60;
  sm.checkSchedule();

  // Inspect MQTT publishes for audio zone command playAudioFX Huge_Braam.mp3
  const braamMsg = mqtt._published.find(({ topic, payload }) => (
    /paradox\/houdini\/audio\/commands$/.test(topic) &&
    payload && payload.command === 'playAudioFX' && /Huge_Braam\.mp3/.test(payload.file || '')
  ));
  assert(braamMsg, 'Expected audio playAudioFX Huge_Braam.mp3 MQTT publish');

  console.log('e2e-playAudioFX-smoke.js PASS');
})();
