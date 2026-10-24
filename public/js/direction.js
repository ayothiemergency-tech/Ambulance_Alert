// Direction detection — ported from the MATLAB script, run in the browser so no
// paid Cloud Function / Blaze plan is needed. Identical math to functions/direction.js.

const R = 6371000;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

function angleDiff(a, b) {
  let d = Math.abs(a - b);
  if (d > 180) d = 360 - d;
  return d;
}

function distanceAndBearing(latA, lonA, latV, lonV) {
  const phi1 = toRad(latA);
  const phi2 = toRad(latV);
  const deltaPhi = toRad(latV - latA);
  const deltaLambda = toRad(lonV - lonA);

  const a = Math.sin(deltaPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const bearing = (toDeg(Math.atan2(y, x)) + 360) % 360;

  return { distance, bearing };
}

function evaluateVehicle(amb, veh) {
  const { distance, bearing } = distanceAndBearing(amb.lat, amb.lon, veh.lat, veh.lon);
  const bearingDiff = angleDiff(amb.heading, bearing);
  const laneAlignment = angleDiff(amb.heading, veh.heading);
  const headingError = Math.max(bearingDiff, laneAlignment);
  return { distance, headingError };
}

export function alertThreshold(ambSpeedKmh) {
  return 200 + ambSpeedKmh * (1000 / 3600) * 15;
}

export function decide(amb, veh) {
  const { distance, headingError } = evaluateVehicle(amb, veh);
  const threshold = alertThreshold(amb.speed || 0);
  const alert = distance <= threshold && headingError <= 45;
  return {
    distance: Math.round(distance * 10) / 10,
    headingError: Math.round(headingError * 10) / 10,
    alert,
  };
}
