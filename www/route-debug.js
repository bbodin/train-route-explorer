export function routeDebug(scope, event, details = {}) {
  console.info(`[route-debug][${scope}] ${event}`, {
    at: new Date().toISOString(),
    ...details,
  });
}

export function routeConfigSummary(config = {}) {
  return {
    departures: config.local_origins || [],
    via: config.connection_stations || [],
    avoid: config.avoid_stations || [],
    arrivals: config.side_b_destinations || [],
    trainTypes: config.train_types || [],
    minTransferMinutes: config.min_transfer_minutes,
    maxTransferMinutes: config.max_transfer_minutes,
    maxTransfers: config.max_transfer_count,
    maxDurationMinutes: config.max_journey_duration_minutes,
    unrestrictedTransfers: !(config.connection_stations || []).length,
  };
}
