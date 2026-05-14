import {
  buildUsageFromDetails,
  calculateCost,
  collectUsageDetails,
  extractTotalTokens,
  filterUsageByTimeRange,
  getModelNamesFromUsage,
  resolveUsageFilterWindow,
  type ModelPrice,
  type UsageDetailRecord,
  type UsageTimeRange,
} from '@/utils/usage'
import type {
  PricingEntry,
  PricingResponse,
  StatusResponse,
  UpdateCheckResponse,
  UsageAnalysisApi,
  UsageAnalysisModel,
  UsageAnalysisResponse,
  UsageEvent,
  UsageEventModelFilterOptionsResponse,
  UsageEventSourceFilterOptionsResponse,
  UsageEventsResponse,
  UsageOverviewResponse,
  UsageOverviewSeries,
  UsageOverviewServiceHealth,
  UsageOverviewSummary,
  UsageSnapshot,
  UsedModelsResponse,
} from './types'

const APP_BASE_PATH_PLACEHOLDER = '__APP_BASE_PATH__'
const STATIC_USAGE_JSON_URL = import.meta.env.VITE_USAGE_JSON_URL?.trim() || 'usage-latest.json'
const STATIC_MODEL_PRICES_URL = import.meta.env.VITE_MODEL_PRICES_URL?.trim() || 'model-prices.json'
const STATIC_TIMEZONE = 'Asia/Shanghai'
const DEFAULT_EVENTS_PAGE_SIZE = 100
const HOUR_MS = 60 * 60 * 1000
const DAY_MINUTES = 24 * 60
const HEALTH_BUCKET_MS = 15 * 60 * 1000
const HEALTH_ROWS = 7
const HEALTH_COLUMNS = 96
const HOUR_BUCKET_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

declare global {
  interface Window {
    __APP_BASE_PATH__?: string
  }
}

interface StaticUsageExport {
  version?: number
  exported_at?: string
  usage?: UsageSnapshot
}

interface StaticUsageState {
  exportedAt?: string
  dataRangeStart?: string
  dataRangeEnd?: string
  usage: UsageSnapshot
  details: UsageDetailRecord[]
}

interface UsageAnalysisApiAccumulator extends Omit<UsageAnalysisApi, 'models'> {
  models: Map<string, UsageAnalysisModel>
}

let staticUsageStatePromise: Promise<StaticUsageState> | null = null
let staticUsageState: StaticUsageState | null = null

function normalizeBasePath(basePath: string | undefined): string {
  if (!basePath || basePath === '/' || basePath === APP_BASE_PATH_PLACEHOLDER) {
    return ''
  }
  return basePath.endsWith('/') ? basePath.slice(0, -1) : basePath
}

export function apiPath(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const basePath = typeof window === 'undefined' ? '' : normalizeBasePath(window.__APP_BASE_PATH__)
  return `${basePath}/api/v1${normalizedPath}`
}

function resolveStaticUsageJsonUrl(): string {
  const base = typeof window === 'undefined' ? 'http://localhost/' : window.location.href
  return new URL(STATIC_USAGE_JSON_URL, base).toString()
}

function resolveStaticModelPricesUrl(): string {
  const base = typeof window === 'undefined' ? 'http://localhost/' : window.location.href
  return new URL(STATIC_MODEL_PRICES_URL, base).toString()
}

function toNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeNumberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nextValue]) => [key, toNumber(nextValue)])
  )
}

function normalizeUsageSnapshot(value: Partial<UsageSnapshot> | undefined): UsageSnapshot {
  return {
    total_requests: toNumber(value?.total_requests),
    success_count: toNumber(value?.success_count),
    failure_count: toNumber(value?.failure_count),
    total_tokens: toNumber(value?.total_tokens),
    requests_by_day: normalizeNumberRecord(value?.requests_by_day),
    requests_by_hour: normalizeNumberRecord(value?.requests_by_hour),
    tokens_by_day: normalizeNumberRecord(value?.tokens_by_day),
    tokens_by_hour: normalizeNumberRecord(value?.tokens_by_hour),
    apis: value?.apis ?? {},
  }
}

async function loadStaticUsageState(): Promise<StaticUsageState> {
  if (staticUsageState) {
    return staticUsageState
  }
  if (!staticUsageStatePromise) {
    staticUsageStatePromise = (async () => {
      const response = await fetch(resolveStaticUsageJsonUrl(), { cache: 'no-store' })
      if (!response.ok) {
        throw new ApiError(`Failed to load ${STATIC_USAGE_JSON_URL}: ${response.status}`, response.status)
      }
      const payload = await response.json() as StaticUsageExport
      if (!payload.usage) {
        throw new ApiError(`${STATIC_USAGE_JSON_URL} does not contain a usage object`, 422)
      }

      const rawUsage = normalizeUsageSnapshot(payload.usage)
      const rawDetails = collectUsageDetails(rawUsage)
      const usage = rawDetails.length
        ? normalizeUsageSnapshot(buildUsageFromDetails(rawDetails) as UsageSnapshot)
        : rawUsage
      const details = collectUsageDetails(usage)
      const dataRange = getStaticUsageDataRange(details)
      const nextState: StaticUsageState = {
        exportedAt: payload.exported_at,
        dataRangeStart: dataRange?.start,
        dataRangeEnd: dataRange?.end,
        usage,
        details,
      }
      staticUsageState = nextState
      return nextState
    })().catch((error) => {
      staticUsageStatePromise = null
      throw error
    })
  }
  return staticUsageStatePromise
}

function getStaticUsageDataRange(details: UsageDetailRecord[]): { start: string; end: string } | null {
  let earliestMs = Number.POSITIVE_INFINITY
  let latestMs = Number.NEGATIVE_INFINITY
  details.forEach((detail) => {
    const timestamp = detail.__timestampMs ?? Date.parse(detail.timestamp)
    if (!Number.isFinite(timestamp) || timestamp <= 0) return
    earliestMs = Math.min(earliestMs, timestamp)
    latestMs = Math.max(latestMs, timestamp)
  })
  if (!Number.isFinite(earliestMs) || !Number.isFinite(latestMs)) return null
  return {
    start: new Date(earliestMs).toISOString(),
    end: new Date(latestMs).toISOString(),
  }
}

function getCurrentRangeAnchorMs(): number {
  return Date.now()
}

function normalizeCustomStart(value?: string): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00` : trimmed
}

function normalizeCustomEnd(value?: string): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T23:59:59.999` : trimmed
}

function getRangeOptions(state: StaticUsageState, start?: string, end?: string) {
  return {
    nowMs: getCurrentRangeAnchorMs(),
    customStart: normalizeCustomStart(start),
    customEnd: normalizeCustomEnd(end),
  }
}

function normalizeUsageRange(range: string): UsageTimeRange {
  return range === '4h' || range === '8h' || range === '12h' || range === '24h' || range === 'today' || range === '7d' || range === '30d' || range === 'custom' || range === 'all'
    ? range
    : 'all'
}

function resolveStaticUsageForRange(state: StaticUsageState, range: string, start?: string, end?: string) {
  const typedRange = normalizeUsageRange(range)
  const rangeOptions = getRangeOptions(state, start, end)
  const filteredUsage = normalizeUsageSnapshot(filterUsageByTimeRange(state.usage, typedRange, rangeOptions) as UsageSnapshot)
  const window = resolveUsageFilterWindow(state.usage, typedRange, rangeOptions)
  return { filteredUsage, window }
}

function normalizeModelPrices(value: unknown): Record<string, ModelPrice> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([model, price]) => {
        const normalizedModel = model.trim()
        const row = price && typeof price === 'object' && !Array.isArray(price)
          ? price as Partial<ModelPrice>
          : {}
        return [normalizedModel, {
          prompt: toNumber(row.prompt),
          completion: toNumber(row.completion),
          cache: toNumber(row.cache),
        }] as const
      })
      .filter(([model]) => Boolean(model))
  )
}

async function loadConfiguredModelPrices(signal?: AbortSignal): Promise<Record<string, ModelPrice>> {
  const response = await fetch(resolveStaticModelPricesUrl(), { cache: 'no-store', signal })
  if (response.status === 404) {
    return {}
  }
  if (!response.ok) {
    throw new ApiError(`Failed to load ${STATIC_MODEL_PRICES_URL}: ${response.status}`, response.status)
  }
  return normalizeModelPrices(await response.json())
}

function modelPricesToPricingEntries(prices: Record<string, ModelPrice>): PricingEntry[] {
  return Object.entries(prices).map(([model, price]) => ({
    model,
    prompt_price_per_1m: price.prompt,
    completion_price_per_1m: price.completion,
    cache_price_per_1m: price.cache,
  }))
}

function parseHourBucketOffsetMinutes(key?: string): number {
  const match = key?.match(HOUR_BUCKET_PATTERN)
  const offset = match?.[7]
  if (!offset || offset === 'Z') return 0
  const sign = offset[0] === '-' ? -1 : 1
  const hours = Number(offset.slice(1, 3))
  const minutes = Number(offset.slice(4, 6))
  return sign * ((hours * 60) + minutes)
}

function startOfOffsetHourMs(timestampMs: number, offsetMinutes: number): number {
  const shiftedMs = timestampMs + offsetMinutes * 60 * 1000
  return Math.floor(shiftedMs / HOUR_MS) * HOUR_MS - offsetMinutes * 60 * 1000
}

function formatHourBucketKey(timestampMs: number, referenceKey?: string): string {
  const offsetMinutes = parseHourBucketOffsetMinutes(referenceKey)
  const shifted = new Date(timestampMs + offsetMinutes * 60 * 1000)
  const pad = (value: number) => String(value).padStart(2, '0')
  const offset = offsetMinutes === 0
    ? 'Z'
    : `${offsetMinutes < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:00:00${offset}`
}

function startOfHourKey(timestamp: string): string {
  const timestampMs = Date.parse(timestamp)
  return Number.isNaN(timestampMs) ? '' : formatHourBucketKey(timestampMs, timestamp)
}

function startOfDayKey(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function createEmptySeries(): UsageOverviewSeries {
  return {
    requests: {},
    tokens: {},
    rpm: {},
    tpm: {},
    cost: {},
    input_tokens: {},
    output_tokens: {},
    cached_tokens: {},
    reasoning_tokens: {},
    models: {},
  }
}

function addSeriesValue(series: UsageOverviewSeries, key: string, detail: UsageDetailRecord, prices: Record<string, ModelPrice>): void {
  if (!key) return
  const tokens = detail.tokens ?? {
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cached_tokens: 0,
    total_tokens: 0,
  }
  series.requests[key] = (series.requests[key] ?? 0) + 1
  series.tokens[key] = (series.tokens[key] ?? 0) + extractTotalTokens(detail)
  series.input_tokens[key] = (series.input_tokens[key] ?? 0) + toNumber(tokens.input_tokens)
  series.output_tokens[key] = (series.output_tokens[key] ?? 0) + toNumber(tokens.output_tokens)
  series.cached_tokens[key] = (series.cached_tokens[key] ?? 0) + toNumber(tokens.cached_tokens)
  series.reasoning_tokens[key] = (series.reasoning_tokens[key] ?? 0) + toNumber(tokens.reasoning_tokens)
  series.cost[key] = (series.cost[key] ?? 0) + calculateCost(detail, prices)
}

function finalizeSeriesRates(series: UsageOverviewSeries, windowMinutes: number): UsageOverviewSeries {
  const divisor = Math.max(windowMinutes, 1)
  Object.keys(series.requests).forEach((key) => {
    series.rpm[key] = (series.requests[key] ?? 0) / divisor
  })
  Object.keys(series.tokens).forEach((key) => {
    series.tpm[key] = (series.tokens[key] ?? 0) / divisor
  })
  Object.values(series.models ?? {}).forEach((modelSeries) => finalizeSeriesRates(modelSeries, windowMinutes))
  return series
}

function buildOverviewSeries(details: UsageDetailRecord[], period: 'hour' | 'day', prices: Record<string, ModelPrice>): UsageOverviewSeries {
  const series = createEmptySeries()
  const bucketMinutes = period === 'hour' ? 60 : DAY_MINUTES
  details.forEach((detail) => {
    const key = period === 'hour' ? startOfHourKey(detail.timestamp) : startOfDayKey(detail.timestamp)
    addSeriesValue(series, key, detail, prices)

    const modelName = detail.__modelName?.trim()
    if (!modelName) return
    const modelSeries = series.models?.[modelName] ?? createEmptySeries()
    addSeriesValue(modelSeries, key, detail, prices)
    if (series.models) {
      series.models[modelName] = modelSeries
    }
  })
  return finalizeSeriesRates(series, bucketMinutes)
}

function buildOverviewSummary(usage: UsageSnapshot, details: UsageDetailRecord[], windowMinutes: number, prices: Record<string, ModelPrice>): UsageOverviewSummary {
  const resolvedWindowMinutes = Math.max(windowMinutes, 1)
  const totals = details.reduce((acc, detail) => {
    acc.cached += toNumber(detail.tokens?.cached_tokens)
    acc.reasoning += toNumber(detail.tokens?.reasoning_tokens)
    acc.cost += calculateCost(detail, prices)
    return acc
  }, { cached: 0, reasoning: 0, cost: 0 })

  return {
    request_count: usage.total_requests,
    token_count: usage.total_tokens,
    window_minutes: resolvedWindowMinutes,
    rpm: usage.total_requests / resolvedWindowMinutes,
    tpm: usage.total_tokens / resolvedWindowMinutes,
    total_cost: totals.cost,
    cost_available: Object.keys(prices).length > 0,
    cached_tokens: totals.cached,
    reasoning_tokens: totals.reasoning,
  }
}

function buildServiceHealth(details: UsageDetailRecord[], anchorMs: number): UsageOverviewServiceHealth {
  const totalBuckets = HEALTH_ROWS * HEALTH_COLUMNS
  const windowEnd = startOfOffsetHourMs(anchorMs || Date.now(), 0) + HOUR_MS
  const windowStart = windowEnd - totalBuckets * HEALTH_BUCKET_MS
  const buckets = Array.from({ length: totalBuckets }, (_, index) => ({
    startMs: windowStart + index * HEALTH_BUCKET_MS,
    success: 0,
    failure: 0,
  }))

  details.forEach((detail) => {
    const timestampMs = detail.__timestampMs ?? Date.parse(detail.timestamp)
    if (!Number.isFinite(timestampMs) || timestampMs < windowStart || timestampMs >= windowEnd) return
    const index = Math.floor((timestampMs - windowStart) / HEALTH_BUCKET_MS)
    const bucket = buckets[index]
    if (!bucket) return
    if (detail.failed) bucket.failure += 1
    else bucket.success += 1
  })

  const totalSuccess = buckets.reduce((sum, bucket) => sum + bucket.success, 0)
  const totalFailure = buckets.reduce((sum, bucket) => sum + bucket.failure, 0)
  const total = totalSuccess + totalFailure
  return {
    total_success: totalSuccess,
    total_failure: totalFailure,
    success_rate: total > 0 ? (totalSuccess / total) * 100 : 0,
    rows: HEALTH_ROWS,
    columns: HEALTH_COLUMNS,
    bucket_seconds: HEALTH_BUCKET_MS / 1000,
    window_start: new Date(windowStart).toISOString(),
    window_end: new Date(windowEnd).toISOString(),
    block_details: buckets.map((bucket) => {
      const bucketTotal = bucket.success + bucket.failure
      return {
        start_time: new Date(bucket.startMs).toISOString(),
        end_time: new Date(bucket.startMs + HEALTH_BUCKET_MS).toISOString(),
        success: bucket.success,
        failure: bucket.failure,
        rate: bucketTotal > 0 ? bucket.success / bucketTotal : -1,
      }
    }),
  }
}

async function buildUsageOverview(state: StaticUsageState, range: string, start?: string, end?: string, signal?: AbortSignal): Promise<UsageOverviewResponse> {
  const { filteredUsage, window } = resolveStaticUsageForRange(state, range, start, end)
  const details = collectUsageDetails(filteredUsage)
  const windowMinutes = window.windowMinutes ?? 1
  const prices = await loadConfiguredModelPrices(signal)
  const hourlySeries = buildOverviewSeries(details, 'hour', prices)
  const dailySeries = buildOverviewSeries(details, 'day', prices)
  const summary = buildOverviewSummary(filteredUsage, details, windowMinutes, prices)

  return {
    usage: filteredUsage,
    summary,
    series: hourlySeries,
    hourly_series: hourlySeries,
    daily_series: dailySeries,
    service_health: buildServiceHealth(details, getCurrentRangeAnchorMs()),
    timezone: STATIC_TIMEZONE,
    range_start: window.startMs ? new Date(window.startMs).toISOString() : undefined,
    range_end: window.endMs ? new Date(window.endMs).toISOString() : undefined,
  }
}

function toPositiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || !value || value <= 0) return fallback
  return Math.floor(value)
}

function toUsageEvent(detail: UsageDetailRecord, index: number): UsageEvent {
  return {
    id: index + 1,
    timestamp: detail.timestamp,
    model: detail.__modelName ?? '',
    source: detail.source ?? '',
    source_raw: detail.source_raw,
    source_type: detail.source_type,
    auth_index: detail.auth_index,
    failed: detail.failed === true,
    latency_ms: toNumber(detail.latency_ms),
    tokens: {
      input_tokens: toNumber(detail.tokens?.input_tokens),
      output_tokens: toNumber(detail.tokens?.output_tokens),
      reasoning_tokens: toNumber(detail.tokens?.reasoning_tokens),
      cached_tokens: toNumber(detail.tokens?.cached_tokens),
      total_tokens: extractTotalTokens(detail),
    },
  }
}

function newAnalysisModel(model: string): UsageAnalysisModel {
  return {
    model,
    total_requests: 0,
    success_count: 0,
    failure_count: 0,
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cached_tokens: 0,
    total_tokens: 0,
    total_latency_ms: 0,
    latency_sample_count: 0,
  }
}

function addDetailToAnalysisModel(stats: UsageAnalysisModel, detail: UsageDetailRecord): void {
  stats.total_requests += 1
  if (detail.failed) stats.failure_count += 1
  else stats.success_count += 1
  stats.input_tokens += toNumber(detail.tokens?.input_tokens)
  stats.output_tokens += toNumber(detail.tokens?.output_tokens)
  stats.reasoning_tokens += toNumber(detail.tokens?.reasoning_tokens)
  stats.cached_tokens += toNumber(detail.tokens?.cached_tokens)
  stats.total_tokens += extractTotalTokens(detail)
  const latencyMs = toNumber(detail.latency_ms)
  if (latencyMs > 0) {
    stats.total_latency_ms += latencyMs
    stats.latency_sample_count += 1
  }
}

function buildUsageAnalysis(usage: UsageSnapshot): UsageAnalysisResponse {
  const apiMap = new Map<string, UsageAnalysisApiAccumulator>()
  const modelMap = new Map<string, UsageAnalysisModel>()

  collectUsageDetails(usage).forEach((detail) => {
    const apiKey = detail.__apiName ?? 'unknown'
    const displayName = detail.__apiDisplayName ?? apiKey
    const modelName = detail.__modelName ?? 'unknown'
    const apiStats = apiMap.get(apiKey) ?? {
      api_key: apiKey,
      display_name: displayName,
      total_requests: 0,
      success_count: 0,
      failure_count: 0,
      input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      cached_tokens: 0,
      total_tokens: 0,
      models: new Map<string, UsageAnalysisModel>(),
    }
    const apiModelStats = apiStats.models.get(modelName) ?? newAnalysisModel(modelName)
    const modelStats = modelMap.get(modelName) ?? newAnalysisModel(modelName)

    apiStats.total_requests += 1
    if (detail.failed) apiStats.failure_count += 1
    else apiStats.success_count += 1
    apiStats.input_tokens += toNumber(detail.tokens?.input_tokens)
    apiStats.output_tokens += toNumber(detail.tokens?.output_tokens)
    apiStats.reasoning_tokens += toNumber(detail.tokens?.reasoning_tokens)
    apiStats.cached_tokens += toNumber(detail.tokens?.cached_tokens)
    apiStats.total_tokens += extractTotalTokens(detail)
    addDetailToAnalysisModel(apiModelStats, detail)
    addDetailToAnalysisModel(modelStats, detail)

    apiStats.models.set(modelName, apiModelStats)
    apiMap.set(apiKey, apiStats)
    modelMap.set(modelName, modelStats)
  })

  return {
    apis: Array.from(apiMap.values())
      .map((api) => ({ ...api, models: Array.from(api.models.values()).sort((a, b) => b.total_requests - a.total_requests) }))
      .sort((a, b) => b.total_requests - a.total_requests),
    models: Array.from(modelMap.values()).sort((a, b) => b.total_requests - a.total_requests),
  }
}

export async function fetchUsageOverview(range: string, start?: string, end?: string, _signal?: AbortSignal): Promise<UsageOverviewResponse> {
  const state = await loadStaticUsageState()
  return buildUsageOverview(state, range, start, end, _signal)
}

export interface FetchUsageEventsOptions {
  page?: number
  pageSize?: number
  model?: string
  source?: string
  result?: string
}

export async function fetchUsageEventModelFilterOptions(_signal?: AbortSignal): Promise<UsageEventModelFilterOptionsResponse> {
  const state = await loadStaticUsageState()
  return { models: getModelNamesFromUsage(state.usage) }
}

export async function fetchUsageEventSourceFilterOptions(_signal?: AbortSignal): Promise<UsageEventSourceFilterOptionsResponse> {
  const state = await loadStaticUsageState()
  const sources = new Map<string, string>()
  state.details.forEach((detail) => {
    const value = String(detail.source ?? '').trim()
    if (!value) return
    sources.set(value, String(detail.source_display ?? value).trim() || value)
  })
  return {
    sources: Array.from(sources.entries())
      .map(([value, label]) => ({ value, label, displayName: label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  }
}

export async function fetchUsageEvents(range: string, start?: string, end?: string, _signal?: AbortSignal, options?: FetchUsageEventsOptions): Promise<UsageEventsResponse> {
  const state = await loadStaticUsageState()
  const { filteredUsage } = resolveStaticUsageForRange(state, range, start, end)
  let details = collectUsageDetails(filteredUsage)

  const model = options?.model?.trim()
  if (model) {
    details = details.filter((detail) => detail.__modelName === model)
  }
  const source = options?.source?.trim()
  if (source) {
    details = details.filter((detail) => detail.source === source || detail.source_display === source || detail.auth_index === source)
  }
  const result = options?.result?.trim()
  if (result === 'success') {
    details = details.filter((detail) => !detail.failed)
  } else if (result === 'failed') {
    details = details.filter((detail) => detail.failed)
  }

  const page = toPositiveInteger(options?.page, 1)
  const pageSize = toPositiveInteger(options?.pageSize, DEFAULT_EVENTS_PAGE_SIZE)
  const events = details.map(toUsageEvent)
  const totalCount = events.length
  const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize)
  const offset = (page - 1) * pageSize
  return {
    events: events.slice(offset, offset + pageSize),
    total_count: totalCount,
    page,
    page_size: pageSize,
    total_pages: totalPages,
  }
}

export async function fetchUsageAnalysis(range: string, start?: string, end?: string, _signal?: AbortSignal): Promise<UsageAnalysisResponse> {
  const state = await loadStaticUsageState()
  const { filteredUsage } = resolveStaticUsageForRange(state, range, start, end)
  return buildUsageAnalysis(filteredUsage)
}

export async function fetchUsedModels(_signal?: AbortSignal): Promise<UsedModelsResponse> {
  const state = await loadStaticUsageState()
  return { models: getModelNamesFromUsage(state.usage) }
}

export async function fetchStatus(_signal?: AbortSignal): Promise<StatusResponse> {
  const state = await loadStaticUsageState()
  return {
    running: false,
    sync_running: false,
    timezone: STATIC_TIMEZONE,
    version: 'static',
    updateCheckEnabled: false,
    last_run_at: state.exportedAt,
    data_range_start: state.dataRangeStart,
    data_range_end: state.dataRangeEnd,
    last_status: 'static-json',
  }
}

export async function fetchUpdateCheck(_signal?: AbortSignal): Promise<UpdateCheckResponse> {
  return {
    currentVersion: 'static',
    latestVersion: 'static',
    updateAvailable: false,
    canCompare: false,
    message: 'Static frontend mode does not check backend releases.',
  }
}

export async function triggerSync(_signal?: AbortSignal): Promise<StatusResponse> {
  return fetchStatus()
}

export async function fetchPricing(_signal?: AbortSignal): Promise<PricingResponse> {
  return { pricing: modelPricesToPricingEntries(await loadConfiguredModelPrices(_signal)) }
}
