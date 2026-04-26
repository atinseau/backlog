// Reactive global "now" timestamp updated once per second. Used to recompute
// elapsed/eta on cards without round-trips to the server.

let _now = $state(Date.now());
let interval: ReturnType<typeof setInterval> | null = null;
let consumers = 0;

function start() {
  if (interval) return;
  interval = setInterval(() => {
    _now = Date.now();
  }, 1000);
}

function stop() {
  if (!interval) return;
  clearInterval(interval);
  interval = null;
}

export function useTimer() {
  consumers += 1;
  start();
  return {
    get now() {
      return _now;
    },
    release() {
      consumers = Math.max(0, consumers - 1);
      if (consumers === 0) stop();
    },
  };
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 s";
  const total = Math.round(seconds);
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes - hours * 60;
  if (hours < 24) return remMin === 0 ? `${hours} h` : `${hours} h ${remMin} min`;
  const days = Math.floor(hours / 24);
  const remHour = hours - days * 24;
  return remHour === 0 ? `${days} j` : `${days} j ${remHour} h`;
}

export function formatRemaining(etaIso: string | null, now: number): string | null {
  if (!etaIso) return null;
  const etaMs = Date.parse(etaIso);
  if (!Number.isFinite(etaMs)) return null;
  const remainingSec = Math.round((etaMs - now) / 1000);
  if (remainingSec <= 0) return null;
  return formatDuration(remainingSec);
}
