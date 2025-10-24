function pad(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function secondsToMMSS(total) {
  const t = Math.max(0, Math.round(total));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${pad(m)}:${pad(s)}`;
}

function mmssToSeconds(str) {
  if (!str) return 0;
  const [m, s] = String(str).split(':').map((x) => parseInt(x, 10) || 0);
  return m * 60 + s;
}

module.exports = { pad, secondsToMMSS, mmssToSeconds };
