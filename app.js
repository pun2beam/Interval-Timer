const DEFAULTS = { hours: 0, minutes: 2, seconds: 0, volume: 50, muted: false };
const STORAGE_KEY = 'intervalTimerSettings';
const els = {
  hours: document.querySelector('#hours'), minutes: document.querySelector('#minutes'), seconds: document.querySelector('#seconds'),
  status: document.querySelector('#status'), cycle: document.querySelector('#cycle'), time: document.querySelector('#time-display'), countdown: document.querySelector('#countdown-display'),
  error: document.querySelector('#error'), live: document.querySelector('#live-message'), start: document.querySelector('#start'), pause: document.querySelector('#pause'), stop: document.querySelector('#stop'),
  shiftMinus: document.querySelector('#shift-minus'), shiftPlus: document.querySelector('#shift-plus'), reset: document.querySelector('#reset'),
  period: document.querySelector('#configured-period'), shift: document.querySelector('#shift'), nextEnd: document.querySelector('#next-end'), volume: document.querySelector('#volume'), volumeValue: document.querySelector('#volume-value'), mute: document.querySelector('#mute')
};

let state = 'stopped';
let baseStart = 0;
let periodMs = 120000;
let cycleNumber = 0;
let shiftMs = 0;
let pausedAt = 0;
let animationId = 0;
let audioCtx;
let playedCountdown = new Set();
let lastCompletedCycle = 0;
let settings = loadSettings();

function populateSelect(select, max, value) {
  for (let i = 0; i <= max; i += 1) {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = String(i).padStart(2, '0');
    select.append(option);
  }
  select.value = String(value);
}

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}

function saveSettings() {
  const data = {
    hours: Number(els.hours.value), minutes: Number(els.minutes.value), seconds: Number(els.seconds.value),
    volume: Number(els.volume.value), muted: settings.muted
  };
  settings = data;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function selectedPeriodMs() {
  return ((Number(els.hours.value) * 3600) + (Number(els.minutes.value) * 60) + Number(els.seconds.value)) * 1000;
}

function formatHms(totalSeconds) {
  const s = Math.max(0, totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':');
}

function formatPeriod(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}時間${String(m).padStart(2, '0')}分${String(s).padStart(2, '0')}秒` : `${m}分${String(s).padStart(2, '0')}秒`;
}

function currentCycleAt(now) {
  if (now < baseStart + shiftMs) return 1;
  return Math.floor((now - baseStart - shiftMs) / periodMs) + 1;
}

function endTimeFor(cycle) {
  return baseStart + (periodMs * cycle) + shiftMs;
}

function setControls() {
  const running = state === 'running' || state === 'paused';
  els.start.disabled = state === 'running';
  els.pause.disabled = state === 'stopped';
  els.pause.textContent = state === 'paused' ? '再開' : '一時停止';
  [els.hours, els.minutes, els.seconds].forEach((el) => { el.disabled = running; });
}

function setStatus(label) {
  els.status.textContent = label;
}

function announce(message) {
  els.live.textContent = message;
}

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
}

function beep(frequency = 880, duration = 0.14, delay = 0) {
  if (settings.muted || Number(els.volume.value) === 0) return;
  try {
    ensureAudio();
    const start = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = frequency;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Number(els.volume.value) / 100 * 0.18, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  } catch {}
}

function playCountdown(second) { if (periodMs > 1000) beep(620 + second * 18, 0.11); }
function playEnd() { beep(1040, 0.16); beep(1040, 0.16, 0.22); }

function updateDetails(end = null) {
  periodMs = selectedPeriodMs() || periodMs;
  els.period.textContent = `設定周期：${formatPeriod(periodMs)}`;
  els.shift.textContent = `シフト：${shiftMs >= 0 ? '+' : ''}${Math.trunc(shiftMs / 1000)}秒`;
  els.nextEnd.textContent = `次回終了：${end ? new Date(end).toLocaleTimeString() : '--:--:--'}`;
}

function render(now = Date.now()) {
  const displayNow = state === 'paused' ? pausedAt : now;
  let remainingSeconds = Math.ceil(periodMs / 1000);
  let end = null;
  if (state !== 'stopped') {
    const actualCycle = currentCycleAt(displayNow);
    if (actualCycle !== cycleNumber) {
      if (actualCycle === cycleNumber + 1 && displayNow - endTimeFor(cycleNumber) < 1500) playEnd();
      cycleNumber = actualCycle;
      playedCountdown.clear();
    }
    end = endTimeFor(cycleNumber);
    remainingSeconds = Math.ceil((end - displayNow) / 1000);
    if (remainingSeconds <= 0 && state === 'running') {
      playEnd();
      lastCompletedCycle = cycleNumber;
      cycleNumber = currentCycleAt(Date.now());
      if (cycleNumber <= lastCompletedCycle) cycleNumber = lastCompletedCycle + 1;
      playedCountdown.clear();
      end = endTimeFor(cycleNumber);
      remainingSeconds = Math.ceil((end - Date.now()) / 1000);
    }
    els.cycle.textContent = `${cycleNumber}周目`;
    if (state === 'running' && remainingSeconds > 0 && remainingSeconds <= Math.min(10, Math.ceil(periodMs / 1000)) && !playedCountdown.has(remainingSeconds)) {
      playedCountdown.add(remainingSeconds);
      playCountdown(remainingSeconds);
    }
  } else {
    els.cycle.textContent = '0周目';
  }
  els.time.textContent = formatHms(remainingSeconds);
  const isCountdown = state === 'running' && remainingSeconds > 0 && remainingSeconds <= 10;
  els.time.classList.toggle('is-countdown', isCountdown);
  els.countdown.textContent = isCountdown ? String(remainingSeconds) : '';
  setStatus(state === 'paused' ? '一時停止中' : isCountdown ? 'カウントダウン中' : state === 'running' ? '実行中' : '停止中');
  updateDetails(end);
}

function loop() {
  render();
  if (state === 'running') animationId = requestAnimationFrame(loop);
}

function start() {
  periodMs = selectedPeriodMs();
  if (periodMs < 1000) { els.error.textContent = '1秒以上の時間を設定してください。'; return; }
  els.error.textContent = '';
  ensureAudio();
  state = 'running'; baseStart = Date.now(); cycleNumber = 1; shiftMs = 0; playedCountdown.clear(); lastCompletedCycle = 0;
  saveSettings(); setControls(); announce('タイマーを開始しました。'); cancelAnimationFrame(animationId); loop();
}

function togglePause() {
  if (state === 'running') { state = 'paused'; pausedAt = Date.now(); cancelAnimationFrame(animationId); announce('一時停止しました。'); }
  else if (state === 'paused') { shiftMs += Date.now() - pausedAt; state = 'running'; playedCountdown.clear(); announce('再開しました。'); loop(); }
  setControls(); render();
}

function stop() {
  state = 'stopped'; cycleNumber = 0; shiftMs = 0; pausedAt = 0; playedCountdown.clear(); cancelAnimationFrame(animationId); setControls(); render(); announce('停止しました。');
}

function shift(delta) {
  if (state === 'stopped') return;
  shiftMs += delta;
  playedCountdown.clear();
  if (state === 'running' && endTimeFor(cycleNumber) <= Date.now()) playEnd();
  render();
}

function reset() {
  if (state !== 'stopped' && !confirm('実行中のタイマーをリセットしますか？')) return;
  stop();
  els.hours.value = String(DEFAULTS.hours); els.minutes.value = String(DEFAULTS.minutes); els.seconds.value = String(DEFAULTS.seconds);
  els.volume.value = String(DEFAULTS.volume); settings.muted = DEFAULTS.muted; updateVolume(); saveSettings(); render();
}

function updateVolume() {
  els.volumeValue.textContent = `${els.volume.value}%`;
  els.mute.textContent = settings.muted ? 'ミュート解除' : 'ミュート';
  els.mute.setAttribute('aria-pressed', String(settings.muted));
}

function ignoreShortcut(event) {
  return ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(event.target.tagName);
}

populateSelect(els.hours, 23, settings.hours); populateSelect(els.minutes, 59, settings.minutes); populateSelect(els.seconds, 59, settings.seconds);
els.volume.value = String(settings.volume); updateVolume(); updateDetails(); render();
[els.hours, els.minutes, els.seconds, els.volume].forEach((el) => el.addEventListener('change', () => { saveSettings(); updateVolume(); render(); }));
els.start.addEventListener('click', start); els.pause.addEventListener('click', togglePause); els.stop.addEventListener('click', stop);
els.shiftPlus.addEventListener('click', () => shift(1000)); els.shiftMinus.addEventListener('click', () => shift(-1000)); els.reset.addEventListener('click', reset);
els.mute.addEventListener('click', () => { settings.muted = !settings.muted; updateVolume(); saveSettings(); });
document.addEventListener('keydown', (event) => {
  if (ignoreShortcut(event)) return;
  if (event.code === 'Space') { event.preventDefault(); state === 'stopped' ? start() : togglePause(); }
  else if (event.key === 'Escape') stop();
  else if (event.key === 'ArrowRight' || event.key === '+') shift(1000);
  else if (event.key === 'ArrowLeft' || event.key === '-') shift(-1000);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
window.addEventListener('focus', () => render());
