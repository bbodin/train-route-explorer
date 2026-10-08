export function normalizeTimeSetting(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const match = text.match(/^(\d{1,2}):([0-5]\d)$/);
  if (!match) return "";
  const hours = Number(match[1]);
  if (hours < 0 || hours > 23) return "";
  return `${String(hours).padStart(2, "0")}:${match[2]}`;
}

export function timeSettingToMinutes(value) {
  const normalized = normalizeTimeSetting(value);
  if (!normalized) return null;
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

function itineraryMatchesTimeConstraints(itinerary, config) {
  const departure = Number(itinerary?.departure_minutes);
  const arrival = Number(itinerary?.arrival_minutes);
  const firstDeparture = timeSettingToMinutes(config.first_departure_time);
  const lastDeparture = timeSettingToMinutes(config.last_departure_time);
  const firstArrival = timeSettingToMinutes(config.first_arrival_time);
  const lastArrival = timeSettingToMinutes(config.last_arrival_time);

  if (firstDeparture !== null && (!Number.isFinite(departure) || departure < firstDeparture)) return false;
  if (lastDeparture !== null && (!Number.isFinite(departure) || departure > lastDeparture)) return false;
  if (firstArrival !== null && (!Number.isFinite(arrival) || arrival < firstArrival)) return false;
  if (lastArrival !== null && (!Number.isFinite(arrival) || arrival > lastArrival)) return false;
  return true;
}

export function applyRouteTimeConstraints(result, config = {}) {
  return {
    ...result,
    outward: (result?.outward || []).filter((itinerary) => itineraryMatchesTimeConstraints(itinerary, config)),
    returns: (result?.returns || []).filter((itinerary) => itineraryMatchesTimeConstraints(itinerary, config)),
  };
}
