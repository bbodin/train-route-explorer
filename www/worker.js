import init, { build_context, routes_for_day_with_progress } from "./pkg/train_route_explorer.js";
import { routeConfigSummary, routeDebug } from "./route-debug.js?v=0.2";
import { applyRouteStationConstraints } from "./route-constraints.js?v=0.1";
import { applyRouteTimeConstraints, normalizeTimeSetting } from "./time-constraints.js?v=0.1";

const CACHE_DB = "train-route-explorer";
const DB_VERSION = 2;
const CONTEXT_STORE = "contexts";
const SOURCE_STORE = "sources";
const LAST_SOURCE_KEY = "__last_source__";
const CACHE_VERSION = "gtfs-context-v5";
const ROUTE_PROTOCOL_VERSION = 8;

let wasmReady = false;
let archiveBytes = null;
let sourceMeta = null;
let activeContext = null;
let activeConfig = null;
let routeShortNamesArchive = null;
let routeShortNames = new Map();

routeDebug("worker", "worker module loaded", { protocolVersion: ROUTE_PROTOCOL_VERSION });

async function ensureWasm() {
  if (!wasmReady) {
    await init();
    wasmReady = true;
  }
}

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CONTEXT_STORE)) {
        request.result.createObjectStore(CONTEXT_STORE);
      }
      if (!request.result.objectStoreNames.contains(SOURCE_STORE)) {
        request.result.createObjectStore(SOURCE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeGet(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function storeSet(storeName, key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function normalizedConfig(config) {
  const list = (value) => Array.isArray(value) ? value.map(String).filter(Boolean) : [];
  const minTransfer = Math.max(0, Number(config.min_transfer_minutes ?? 10));
  const maxTransfer = Math.max(minTransfer, Number(config.max_transfer_minutes ?? 120));
  return {
    local_origins: list(config.local_origins),
    connection_stations: list(config.connection_stations),
    avoid_stations: list(config.avoid_stations),
    side_b_destinations: list(config.side_b_destinations),
    train_types: list(config.train_types),
    min_transfer_minutes: minTransfer,
    max_transfer_minutes: maxTransfer,
    max_transfer_count: Math.max(0, Number(config.max_transfer_count ?? 2)),
    max_journey_duration_minutes: Math.max(0, Number(config.max_journey_duration_minutes ?? 1440)),
    first_departure_time: normalizeTimeSetting(config.first_departure_time),
    last_departure_time: normalizeTimeSetting(config.last_departure_time),
    first_arrival_time: normalizeTimeSetting(config.first_arrival_time),
    last_arrival_time: normalizeTimeSetting(config.last_arrival_time),
  };
}

function buildConfigForCore(config) {
  return {
    local_origins: config.local_origins,
    // Via and Avoid stations are route acceptance constraints, not transfer
    // whitelists. Keep the core unrestricted so changing either list can reuse
    // the same cached GTFS routing context.
    connection_stations: [],
    side_b_destinations: config.side_b_destinations,
    train_types: config.train_types,
    max_transfer_count: config.max_transfer_count,
  };
}

function sameList(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function isDirectionSwap(nextConfig) {
  return Boolean(
    activeConfig
    && sameList(nextConfig.local_origins, activeConfig.side_b_destinations)
    && sameList(nextConfig.side_b_destinations, activeConfig.local_origins)
    && sameList(nextConfig.connection_stations, activeConfig.connection_stations)
    && sameList(nextConfig.avoid_stations, activeConfig.avoid_stations)
    && sameList(nextConfig.train_types, activeConfig.train_types)
    && nextConfig.max_transfer_count === activeConfig.max_transfer_count
    && nextConfig.first_departure_time === activeConfig.first_departure_time
    && nextConfig.last_departure_time === activeConfig.last_departure_time
    && nextConfig.first_arrival_time === activeConfig.first_arrival_time
    && nextConfig.last_arrival_time === activeConfig.last_arrival_time
  );
}

function swapActiveContextDirection() {
  [activeContext.local_to_connection, activeContext.side_b_to_connection] =
    [activeContext.side_b_to_connection, activeContext.local_to_connection];
  [activeContext.local_to_side_b, activeContext.side_b_to_local] =
    [activeContext.side_b_to_local, activeContext.local_to_side_b];
  [activeContext.connection_to_side_b, activeContext.connection_to_local] =
    [activeContext.connection_to_local, activeContext.connection_to_side_b];
  [activeContext.unrestricted_origins, activeContext.unrestricted_destinations] =
    [activeContext.unrestricted_destinations, activeContext.unrestricted_origins];
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function ensureSourceHash(bytes, meta) {
  if (meta.hash) return meta.hash;
  meta.hash = await sha256(bytes);
  return meta.hash;
}

async function cacheKey(bytes, meta, config) {
  const sourceHash = await ensureSourceHash(bytes, meta);
  const { sourceKey, ...cacheMeta } = meta;
  return JSON.stringify({
    version: CACHE_VERSION,
    source: { ...cacheMeta, hash: sourceHash },
    config: buildConfigForCore(config),
  });
}

function sourceKeyForBundled(url) {
  return `bundled:${url}`;
}

function sourceRecordBytes(record) {
  if (record.bytes instanceof Uint8Array) return record.bytes;
  return new Uint8Array(record.bytes);
}

async function loadStoredSource(sourceKey) {
  const record = await storeGet(SOURCE_STORE, sourceKey);
  if (!record || !record.bytes || !record.meta) return null;
  return {
    bytes: sourceRecordBytes(record),
    meta: { ...record.meta, sourceKey },
    stored: true,
  };
}

async function loadLastStoredSource() {
  const pointer = await storeGet(SOURCE_STORE, LAST_SOURCE_KEY);
  if (!pointer?.sourceKey) return null;
  return loadStoredSource(pointer.sourceKey);
}

async function storeSource(bytes, meta) {
  const hash = await ensureSourceHash(bytes, meta);
  const sourceKey = meta.sourceKey || (meta.kind === "bundled" ? sourceKeyForBundled(meta.url) : `upload:${hash}`);
  const storedMeta = {
    ...meta,
    hash,
    sourceKey,
    size: bytes.byteLength,
  };
  await storeSet(SOURCE_STORE, sourceKey, {
    bytes,
    meta: storedMeta,
    storedAt: new Date().toISOString(),
  });
  await storeSet(SOURCE_STORE, LAST_SOURCE_KEY, { sourceKey });
  return storedMeta;
}

async function fetchArchive(url) {
  let response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch (error) {
    throw new Error(`Cannot fetch ${url}. The remote server may not allow browser downloads from this site. Download it locally to www/data/gtfs.zip and use "Download GTFS from server".`);
  }
  if (!response.ok) {
    throw new Error(`Cannot fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  return {
    bytes: new Uint8Array(buffer),
    meta: {
      kind: "bundled",
      url,
      sourceKey: sourceKeyForBundled(url),
      size: buffer.byteLength,
      lastModified: response.headers.get("last-modified") || "",
    },
  };
}

function findEndOfCentralDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
}

async function zipEntryText(bytes, targetName) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(bytes);
  if (eocdOffset < 0) return "";

  const entryCount = view.getUint16(eocdOffset + 10, true);
  let offset = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder();

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) return "";
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const fileName = decoder.decode(bytes.subarray(offset + 46, offset + 46 + fileNameLength));

    if (fileName === targetName) {
      if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) return "";
      const localNameLength = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataStart, dataStart + compressedSize);

      if (compressionMethod === 0) return decoder.decode(compressed);
      if (compressionMethod !== 8 || typeof DecompressionStream !== "function") return "";

      try {
        const stream = new Blob([compressed])
          .stream()
          .pipeThrough(new DecompressionStream("deflate-raw"));
        return await new Response(stream).text();
      } catch (error) {
        return "";
      }
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return "";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        value += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value);
      value = "";
      if (row.some((field) => field.length)) rows.push(row);
      row = [];
    } else if (character !== "\r") {
      value += character;
    }
  }

  row.push(value);
  if (row.some((field) => field.length)) rows.push(row);
  return rows;
}

async function ensureRouteShortNames() {
  if (!archiveBytes || routeShortNamesArchive === archiveBytes) return;
  routeShortNamesArchive = archiveBytes;
  routeShortNames = new Map();

  const text = await zipEntryText(archiveBytes, "routes.txt");
  if (!text) return;

  const rows = parseCsv(text);
  if (!rows.length) return;

  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").trim());
  const routeIdIndex = headers.indexOf("route_id");
  const shortNameIndex = headers.indexOf("route_short_name");
  if (routeIdIndex < 0 || shortNameIndex < 0) return;

  for (const row of rows.slice(1)) {
    const routeId = String(row[routeIdIndex] || "").trim();
    const shortName = String(row[shortNameIndex] || "").trim();
    if (routeId && shortName) routeShortNames.set(routeId, shortName);
  }
}

function publicTerLineCode(value) {
  const code = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!code || code.length > 6) return "";
  if (/^[A-Z]{1,3}\d{1,3}[A-Z]?$/.test(code)) return code;
  if (/^\d{1,3}$/.test(code)) return code;
  return "";
}

function applyPublicTrainCodes(result) {
  for (const itinerary of [...(result.outward || []), ...(result.returns || [])]) {
    for (const leg of itinerary.legs || []) {
      if (leg.train_type !== "TER") continue;
      const lineCode = publicTerLineCode(routeShortNames.get(String(leg.route_id || "")));
      if (lineCode) leg.train_number = lineCode;
    }
  }
  return result;
}

async function buildOrLoadContext(config) {
  if (!archiveBytes || !sourceMeta) {
    throw new Error("Load a GTFS archive first.");
  }

  const startedAt = performance.now();
  routeDebug("worker", "context load started", { config: routeConfigSummary(config) });
  await ensureRouteShortNames();

  const key = await cacheKey(archiveBytes, sourceMeta, config);
  post("progress", { message: "Checking browser cache...", progress: 5 });
  const cached = await storeGet(CONTEXT_STORE, key);
  if (cached) {
    activeContext = cached;
    activeConfig = config;
    sourceMeta = await storeSource(archiveBytes, sourceMeta);
    post("ready", { context: activeContext, cached: true, source: sourceMeta });
    routeDebug("worker", "context cache hit", {
      elapsedMs: Math.round(performance.now() - startedAt),
      availableDayCount: activeContext.available_days?.length || 0,
    });
    return;
  }

  post("progress", { message: "Parsing GTFS and building route context...", progress: 35 });
  activeContext = build_context(archiveBytes, buildConfigForCore(config));
  activeConfig = config;
  post("progress", { message: "Writing browser cache...", progress: 90 });
  await storeSet(CONTEXT_STORE, key, activeContext);
  sourceMeta = await storeSource(archiveBytes, sourceMeta);
  post("ready", { context: activeContext, cached: false, source: sourceMeta });
  routeDebug("worker", "context build completed", {
    elapsedMs: Math.round(performance.now() - startedAt),
    availableDayCount: activeContext.available_days?.length || 0,
  });
}

async function computeRoutes(days, overrides = {}, onProgress = null, selectedDay = null, onWorkProgress = null) {
  if (!activeContext || !activeConfig) {
    throw new Error("Route context is not ready.");
  }
  const config = { ...activeConfig, ...overrides };
  const requestedDays = (Array.isArray(days) ? days : [days]).filter(Boolean);
  routeDebug("worker", "multi-day routing started", {
    days: requestedDays,
    config: routeConfigSummary(config),
  });
  const result = {
    selected_day: selectedDay || requestedDays[0] || null,
    days: requestedDays,
    outward: [],
    returns: [],
  };
  for (const [index, day] of requestedDays.entries()) {
    const dayStartedAt = performance.now();
    let lastReportedPercent = -1;
    routeDebug("worker", "service day routing started", { day, index: index + 1, total: requestedDays.length });
    const dayResult = applyRouteStationConstraints(applyPublicTrainCodes(routes_for_day_with_progress(activeContext, {
      selected_day: day,
      min_transfer_minutes: config.min_transfer_minutes,
      max_transfer_minutes: config.max_transfer_minutes,
      max_transfer_count: config.max_transfer_count,
      max_journey_duration_minutes: config.max_journey_duration_minutes,
    }, (completedWork, totalWork) => {
      const completed = Math.max(0, Number(completedWork || 0));
      const total = Math.max(1, Number(totalWork || 1));
      const percent = Math.max(0, Math.min(100, Math.floor((completed / total) * 100)));
      if (percent === lastReportedPercent && completed < total) return;
      lastReportedPercent = percent;
      onWorkProgress?.({
        day,
        dayIndex: index + 1,
        totalDays: requestedDays.length,
        completedWork: completed,
        totalWork: total,
        percent,
      });
    })), config.connection_stations, config.avoid_stations);
    const filteredDayResult = applyRouteTimeConstraints(dayResult, config);
    result.outward.push(...(filteredDayResult.outward || []));
    result.returns.push(...(filteredDayResult.returns || []));
    routeDebug("worker", "service day routing completed", {
      day,
      elapsedMs: Math.round(performance.now() - dayStartedAt),
      outwardCount: filteredDayResult.outward?.length || 0,
      returnCount: filteredDayResult.returns?.length || 0,
    });
    if (onProgress && index + 1 < requestedDays.length) {
      onProgress(result, index + 1, requestedDays.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  routeDebug("worker", "multi-day routing completed", {
    days: requestedDays,
    outwardCount: result.outward.length,
    returnCount: result.returns.length,
  });
  return result;
}

self.onmessage = async (event) => {
  const { type } = event.data;
  try {
    await ensureWasm();
    if (type === "load-last-source") {
      post("progress", { message: "Checking browser storage for a saved GTFS archive...", progress: 5 });
      const stored = await loadLastStoredSource();
      if (!stored) {
        post("no-source");
        return;
      }
      archiveBytes = stored.bytes;
      sourceMeta = stored.meta;
      post("progress", { message: "Loading saved GTFS archive from browser storage...", progress: 12 });
      await buildOrLoadContext(normalizedConfig(event.data.config));
      return;
    }
    if (type === "load-bundled") {
      const stored = await loadStoredSource(sourceKeyForBundled(event.data.url));
      const loaded = stored || await (async () => {
        post("progress", { message: "Downloading bundled GTFS archive...", progress: 10 });
        return fetchArchive(event.data.url);
      })();
      if (stored) {
        post("progress", { message: "Loading bundled GTFS archive from browser storage...", progress: 10 });
      }
      archiveBytes = loaded.bytes;
      sourceMeta = loaded.meta;
      await buildOrLoadContext(normalizedConfig(event.data.config));
      return;
    }
    if (type === "load-upload") {
      post("progress", { message: "Reading uploaded GTFS archive...", progress: 10 });
      archiveBytes = new Uint8Array(event.data.buffer);
      sourceMeta = {
        kind: "upload",
        name: event.data.name,
        size: archiveBytes.byteLength,
        lastModified: event.data.lastModified || 0,
      };
      await buildOrLoadContext(normalizedConfig(event.data.config));
      return;
    }
    if (type === "apply-config") {
      await buildOrLoadContext(normalizedConfig(event.data.config));
      return;
    }
    if (type === "swap-config") {
      const nextConfig = normalizedConfig(event.data.config);
      if (!activeContext || !isDirectionSwap(nextConfig)) {
        await buildOrLoadContext(nextConfig);
        return;
      }
      swapActiveContextDirection();
      activeConfig = nextConfig;
      routeDebug("worker", "route context direction swapped without rebuild", {
        config: routeConfigSummary(activeConfig),
      });
      return;
    }
    if (type === "routes") {
      if (event.data.protocolVersion !== ROUTE_PROTOCOL_VERSION) {
        throw new Error(
          `Route protocol mismatch: app=${event.data.protocolVersion ?? "missing"}, worker=${ROUTE_PROTOCOL_VERSION}`,
        );
      }
      const requestId = event.data.requestId;
      const result = await computeRoutes(
        event.data.days || event.data.day,
        event.data.overrides || {},
        (partialResult, completedDays, totalDays) => post("routes-progress", {
          requestId,
          result: partialResult,
          completedDays,
          totalDays,
        }),
        event.data.selectedDay,
        (work) => post("route-work-progress", { requestId, ...work }),
      );
      post("routes", { requestId, result });
      return;
    }
  } catch (error) {
    post("error", { message: error && error.message ? error.message : String(error) });
  }
};
