function stationSet(values) {
  return new Set((values || []).map(String).filter(Boolean));
}

function legStationNames(leg) {
  return [
    String(leg?.departure_stop || ""),
    ...(leg?.path || []).map((stop) => String(stop?.stop_name || "")),
    String(leg?.destination_stop || ""),
  ].filter(Boolean);
}

function itineraryPassesViaSet(itinerary, required) {
  if (!required.size) return true;
  const departure = String(itinerary?.departure_stop || "");
  const destination = String(itinerary?.destination_stop || "");

  for (const leg of itinerary?.legs || []) {
    if (legStationNames(leg).some(
      (station) => station !== departure && station !== destination && required.has(station),
    )) {
      return true;
    }
  }
  return false;
}

function itineraryAvoidsSet(itinerary, avoided) {
  if (!avoided.size) return true;
  return (itinerary?.legs || []).every(
    (leg) => !legStationNames(leg).some((station) => avoided.has(station)),
  );
}

export function itineraryPassesVia(itinerary, requiredViaStations) {
  return itineraryPassesViaSet(itinerary, stationSet(requiredViaStations));
}

export function itineraryAvoidsStations(itinerary, avoidedStations) {
  return itineraryAvoidsSet(itinerary, stationSet(avoidedStations));
}

export function applyRouteStationConstraints(
  result,
  requiredViaStations = [],
  avoidedStations = [],
) {
  const required = stationSet(requiredViaStations);
  const avoided = stationSet(avoidedStations);
  if (!required.size && !avoided.size) return result;

  const accepted = (itinerary) => (
    itineraryPassesViaSet(itinerary, required)
    && itineraryAvoidsSet(itinerary, avoided)
  );

  return {
    ...result,
    outward: (result.outward || []).filter(accepted),
    returns: (result.returns || []).filter(accepted),
  };
}
