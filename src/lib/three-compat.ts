import * as THREE from 'three';

// Provide a runtime compatibility shim between deprecated `Clock` and new `Timer`.
// If `Timer` is available, ensure `Clock` references it; otherwise map `Timer` to `Clock`.
const t = THREE as any;
if (!t.Timer && t.Clock) {
  t.Timer = t.Clock;
}
if (!t.Clock && t.Timer) {
  t.Clock = t.Timer;
}

export default THREE;
