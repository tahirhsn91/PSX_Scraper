/**
 * OpenAPI 3.0 specification for the PSX Stock Scraper API.
 * Served as interactive docs at GET /api/docs (Swagger UI) and as raw JSON at GET /api/docs.json.
 *
 * `servers.url` is '/' so that Swagger UI "Try it out" resolves both the API
 * (/api/v1/...) and the root /health endpoint against the same origin that serves the docs.
 */

const ERROR_ENVELOPE = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'NOT_FOUND' },
        message: { type: 'string', example: 'Stock not tracked: FFC' },
        details: { type: 'object', nullable: true, description: 'Optional structured detail (e.g. Zod field errors).' },
        requestId: { type: 'string', format: 'uuid', example: '857ee0da-7044-48e5-adbd-a6794590f654' },
      },
      required: ['code', 'message'],
    },
  },
} as const;

const err = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'PSX Stock Scraper API',
    version: '1.0.0',
    description:
      'REST API for the Pakistan Stock Exchange (PSX) stock data scraper & portfolio backend.\n\n' +
      '- Scraping runs asynchronously via BullMQ; mutating endpoints enqueue jobs and return a `jobId`.\n' +
      '- Poll job progress via the status endpoints.\n' +
      '- All errors share a consistent envelope: `{ error: { code, message, details?, requestId } }`.',
    contact: { name: 'PSX Scraper' },
    license: { name: 'MIT' },
  },
  servers: [
    { url: '/', description: 'Current host (API base is /api/v1)' },
  ],
  tags: [
    { name: 'System', description: 'Service health and liveness.' },
    { name: 'Stocks', description: 'Track, retrieve, and remove PSX stocks.' },
    { name: 'Indices', description: 'Market indices (KSE-100): latest reading, history and sync.' },
    { name: 'History', description: 'Historical end-of-day price data and range fetches.' },
    { name: 'Search', description: 'Fuzzy search across tracked stocks.' },
    { name: 'Sync', description: 'Trigger and observe scrape jobs.' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        description: 'Liveness plus dependency readiness for PostgreSQL and Redis.',
        responses: {
          '200': {
            description: 'Service healthy',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Health' },
                example: { status: 'ok', checks: { database: 'up', redis: 'up' } },
              },
            },
          },
          '503': {
            description: 'One or more dependencies are down',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Health' },
                example: { status: 'degraded', checks: { database: 'up', redis: 'down' } },
              },
            },
          },
        },
      },
    },

    '/api/v1/stocks': {
      get: {
        tags: ['Stocks'],
        summary: 'List tracked stocks',
        description: 'Paginated list of tracked stocks, each with its latest price snapshot and last sync time.',
        parameters: [
          { $ref: '#/components/parameters/Page' },
          { $ref: '#/components/parameters/Limit' },
        ],
        responses: {
          '200': {
            description: 'Paginated list of stocks',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/Paginated' },
                    { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/StockListItem' } } } },
                  ],
                },
              },
            },
          },
          '400': err('Invalid query parameters'),
        },
      },
      post: {
        tags: ['Stocks'],
        summary: 'Add (track) a new stock',
        description: 'Validates the symbol, inserts it, and enqueues a full scrape. Returns a `jobId` the client can poll.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AddStockRequest' },
              example: { symbol: 'FFC' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Stock created and scrape enqueued',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    symbol: { type: 'string', example: 'FFC' },
                    id: { type: 'string', format: 'uuid' },
                    jobId: { type: 'string', example: 'sync-FFC' },
                  },
                },
              },
            },
          },
          '400': err('Invalid symbol'),
          '409': err('Stock already tracked'),
          '429': err('Rate limit exceeded'),
        },
      },
    },

    '/api/v1/stocks/{symbol}': {
      parameters: [{ $ref: '#/components/parameters/Symbol' }],
      get: {
        tags: ['Stocks'],
        summary: 'Get stock detail',
        description: 'Aggregated view: company info, latest price/OHLC, latest ratios, financials, dividends, and last sync status.',
        responses: {
          '200': {
            description: 'Stock detail',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/StockDetail' } } },
          },
          '404': err('Stock not tracked'),
        },
      },
      delete: {
        tags: ['Stocks'],
        summary: 'Remove a stock',
        description: 'Deletes the stock and cascades its prices, financials, ratios, and dividends.',
        responses: {
          '204': { description: 'Deleted (no content)' },
          '404': err('Stock not tracked'),
        },
      },
    },

    '/api/v1/stocks/{symbol}/sync': {
      parameters: [{ $ref: '#/components/parameters/Symbol' }],
      post: {
        tags: ['Sync'],
        summary: 'Sync latest data (on-demand)',
        description: 'Enqueues a single-stock scrape. De-duplicated: if a sync for the symbol is already queued/active, the existing job is reused.',
        responses: {
          '202': {
            description: 'Sync enqueued (or existing job reused)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/JobRef' },
                example: { jobId: 'sync-FFC', symbol: 'FFC', reused: false, state: 'waiting' },
              },
            },
          },
          '404': err('Stock not tracked'),
          '429': err('Rate limit exceeded'),
        },
      },
    },

    '/api/v1/stocks/{symbol}/history': {
      parameters: [{ $ref: '#/components/parameters/Symbol' }],
      get: {
        tags: ['History'],
        summary: 'Get stored price history',
        description: 'Returns persisted end-of-day price rows. A `range` preset takes precedence over an explicit `from` date.',
        parameters: [
          { $ref: '#/components/parameters/Range' },
          { name: 'from', in: 'query', required: false, schema: { type: 'string', format: 'date' }, description: 'Lower bound (ignored if `range` is set).' },
          { name: 'to', in: 'query', required: false, schema: { type: 'string', format: 'date' }, description: 'Upper bound.' },
          { $ref: '#/components/parameters/Page' },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 2000, maximum: 5000 } },
        ],
        responses: {
          '200': {
            description: 'Paginated price rows (newest first)',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/Paginated' },
                    { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/PriceRow' } } } },
                  ],
                },
              },
            },
          },
          '400': err('Invalid query parameters'),
          '404': err('Stock not tracked'),
        },
      },
    },

    '/api/v1/stocks/{symbol}/history/sync': {
      parameters: [{ $ref: '#/components/parameters/Symbol' }],
      post: {
        tags: ['History'],
        summary: 'Fetch historical EOD data for a range',
        description:
          'Enqueues an async job that pulls end-of-day history from PSX for the given range preset and persists it. ' +
          'De-duplicated per symbol; poll `/history/status` for progress.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/HistorySyncRequest' },
              example: { range: '1Y' },
            },
          },
        },
        responses: {
          '202': {
            description: 'History fetch enqueued',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/JobRef' },
                example: { jobId: 'history-FFC', symbol: 'FFC', range: '1Y', reused: false, state: 'waiting' },
              },
            },
          },
          '400': err('Invalid range'),
          '404': err('Stock not tracked'),
          '429': err('Rate limit exceeded'),
        },
      },
    },

    '/api/v1/stocks/{symbol}/history/status': {
      parameters: [{ $ref: '#/components/parameters/Symbol' }],
      get: {
        tags: ['History'],
        summary: 'History fetch job progress',
        description: 'Live state and progress percentage of the symbol’s history-fetch job.',
        responses: {
          '200': {
            description: 'Job state and progress',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HistoryJobStatus' },
                example: {
                  jobId: 'history-FFC', state: 'active',
                  progress: { percent: 60, note: 'persisting' },
                  returnValue: null, failedReason: null,
                },
              },
            },
          },
        },
      },
    },

    '/api/v1/indices': {
      get: {
        tags: ['Indices'],
        summary: 'List tracked indices',
        description:
          'Tracked market indices with their latest reading. Indices are a separate resource from stocks: ' +
          'no company profile, sector, ratios or dividends.',
        parameters: [
          { $ref: '#/components/parameters/Page' },
          { $ref: '#/components/parameters/Limit' },
        ],
        responses: {
          '200': {
            description: 'Paginated list of indices',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/Paginated' },
                    { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/IndexSummary' } } } },
                  ],
                },
              },
            },
          },
          '400': err('Invalid query parameters'),
        },
      },
    },

    '/api/v1/indices/{symbol}': {
      parameters: [{ $ref: '#/components/parameters/IndexSymbol' }],
      get: {
        tags: ['Indices'],
        summary: 'Index summary',
        description:
          'Latest index reading. `value` is the newest intraday reading when a session is open, otherwise the ' +
          'latest daily close; `previousClose` is the last close before that day, and `change`/`changePercent` ' +
          'are derived from the two. `high`/`low` are null because the upstream index series carries only ' +
          'close, open and volume.',
        responses: {
          '200': {
            description: 'Index summary',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/IndexSummary' },
                example: {
                  symbol: 'KSE100',
                  name: 'KSE-100 Index',
                  value: 167970.65,
                  change: -2541.2,
                  changePercent: -1.4903,
                  open: 169830.1135,
                  high: null,
                  low: null,
                  previousClose: 170511.85,
                  volume: 232943686,
                  lastTradeDate: '2026-09-14T11:00:00.000Z',
                },
              },
            },
          },
          '404': err('Index not tracked'),
        },
      },
    },

    '/api/v1/indices/{symbol}/history': {
      parameters: [{ $ref: '#/components/parameters/IndexSymbol' }],
      get: {
        tags: ['Indices'],
        summary: 'Index history (daily closes)',
        description:
          'Persisted daily index values, newest first, in the same envelope and row shape as the stock history ' +
          'endpoint so consumers reuse one mapper. A `range` preset takes precedence over an explicit `from`.',
        parameters: [
          { $ref: '#/components/parameters/Range' },
          { name: 'from', in: 'query', required: false, schema: { type: 'string', format: 'date' }, description: 'Lower bound (ignored if `range` is set).' },
          { name: 'to', in: 'query', required: false, schema: { type: 'string', format: 'date' }, description: 'Upper bound.' },
          { $ref: '#/components/parameters/Page' },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 252, maximum: 5000 } },
        ],
        responses: {
          '200': {
            description: 'Paginated index rows (newest first)',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/Paginated' },
                    { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/PriceRow' } } } },
                  ],
                },
              },
            },
          },
          '400': err('Invalid query parameters'),
          '404': err('Index not tracked'),
        },
      },
    },

    '/api/v1/indices/{symbol}/sync': {
      parameters: [{ $ref: '#/components/parameters/IndexSymbol' }],
      post: {
        tags: ['Indices'],
        summary: 'Sync an index (on-demand)',
        description:
          'Enqueues an index sync (DPS time series → persisted daily values + newest intraday reading). ' +
          'De-duplicated per symbol while a job is queued or active.',
        responses: {
          '202': {
            description: 'Sync enqueued (or existing job reused)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/JobRef' },
                example: { jobId: 'index-KSE100', symbol: 'KSE100', reused: false, state: 'waiting' },
              },
            },
          },
          '404': err('Index not tracked'),
          '429': err('Rate limit exceeded'),
        },
      },
    },

    '/api/v1/indices/{symbol}/sync/status': {
      parameters: [{ $ref: '#/components/parameters/IndexSymbol' }],
      get: {
        tags: ['Indices'],
        summary: 'Index sync job progress',
        description: 'Live state and progress percentage of the index’s sync job.',
        responses: {
          '200': {
            description: 'Job state and progress',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HistoryJobStatus' },
                example: {
                  jobId: 'index-KSE100', state: 'active',
                  progress: { percent: 60, note: 'persisting' },
                  returnValue: null, failedReason: null,
                },
              },
            },
          },
        },
      },
    },

    '/api/v1/search': {
      get: {
        tags: ['Search'],
        summary: 'Search stocks',
        description: 'Fuzzy (trigram) search over symbol and company name, ranked by similarity. Results are cached briefly.',
        parameters: [
          { name: 'q', in: 'query', required: false, schema: { type: 'string' }, example: 'FFC', description: 'Search term (symbol or company).' },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 20, maximum: 50 } },
        ],
        responses: {
          '200': {
            description: 'Search results',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    query: { type: 'string', example: 'FFC' },
                    results: { type: 'array', items: { $ref: '#/components/schemas/SearchResult' } },
                  },
                },
              },
            },
          },
        },
      },
    },

    '/api/v1/sync/all': {
      post: {
        tags: ['Sync'],
        summary: 'Sync all tracked stocks',
        description: 'Enqueues a fan-out job that re-syncs every tracked stock (one child job per symbol).',
        responses: {
          '202': {
            description: 'Fan-out enqueued',
            content: { 'application/json': { schema: { type: 'object', properties: { jobId: { type: 'string', example: 'sync-all-1721770000000' } } } } },
          },
          '429': err('Rate limit exceeded'),
        },
      },
    },

    '/api/v1/sync/status': {
      get: {
        tags: ['Sync'],
        summary: 'Live queue status',
        description: 'Job counts per queue plus the symbols currently being scraped.',
        responses: {
          '200': {
            description: 'Queue status',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SyncStatus' },
                example: {
                  queues: {
                    'stock-sync': { waiting: 0, active: 1, completed: 12, failed: 0, delayed: 0 },
                    'stock-sync-all': { waiting: 0, active: 0, completed: 3, failed: 0 },
                  },
                  inFlight: ['FFC'],
                },
              },
            },
          },
        },
      },
    },

    '/api/v1/sync/logs': {
      get: {
        tags: ['Sync'],
        summary: 'Sync log history',
        description: 'Paginated, filterable history of sync runs (per stock and full-sync batches).',
        parameters: [
          { name: 'symbol', in: 'query', required: false, schema: { type: 'string' }, description: 'Filter by symbol.' },
          { name: 'status', in: 'query', required: false, schema: { $ref: '#/components/schemas/SyncStatusEnum' } },
          { $ref: '#/components/parameters/Page' },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 50, maximum: 200 } },
        ],
        responses: {
          '200': {
            description: 'Paginated sync logs',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/Paginated' },
                    { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/SyncLog' } } } },
                  ],
                },
              },
            },
          },
          '400': err('Invalid query parameters'),
        },
      },
    },
  },

  components: {
    parameters: {
      Symbol: {
        name: 'symbol', in: 'path', required: true,
        schema: { type: 'string', pattern: '^[A-Za-z0-9]{1,12}$' },
        example: 'FFC', description: 'PSX ticker symbol (alphanumeric, case-insensitive).',
      },
      IndexSymbol: {
        name: 'symbol', in: 'path', required: true,
        schema: { type: 'string', pattern: '^[A-Za-z0-9]{1,12}$' },
        example: 'KSE100', description: 'Market index code (alphanumeric, case-insensitive) — e.g. KSE100.',
      },
      Page: { name: 'page', in: 'query', required: false, schema: { type: 'integer', minimum: 1, default: 1 } },
      Limit: { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 200, default: 20 } },
      Range: {
        name: 'range', in: 'query', required: false,
        schema: { $ref: '#/components/schemas/HistoryRange' },
        description: 'Range preset. Overrides `from` when present.',
      },
    },
    schemas: {
      Error: ERROR_ENVELOPE,
      Health: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded'] },
          checks: {
            type: 'object',
            properties: { database: { type: 'string', enum: ['up', 'down'] }, redis: { type: 'string', enum: ['up', 'down'] } },
          },
        },
      },
      Paginated: {
        type: 'object',
        properties: {
          items: { type: 'array', items: {} },
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 20 },
          total: { type: 'integer', example: 42 },
          totalPages: { type: 'integer', example: 3 },
        },
      },
      HistoryRange: { type: 'string', enum: ['1W', '1M', '1Y', '2Y', '3Y', '5Y', 'MAX'] },
      SyncStatusEnum: { type: 'string', enum: ['PENDING', 'RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED'] },
      AddStockRequest: {
        type: 'object', required: ['symbol'],
        properties: { symbol: { type: 'string', pattern: '^[A-Za-z0-9]{1,12}$', example: 'FFC' } },
      },
      HistorySyncRequest: {
        type: 'object', required: ['range'],
        properties: { range: { $ref: '#/components/schemas/HistoryRange' } },
      },
      StockListItem: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          symbol: { type: 'string', example: 'FFC' },
          companyName: { type: 'string', nullable: true, example: 'Fauji Fertilizer Company Limited' },
          sector: { type: 'string', nullable: true, example: 'Fertilizer' },
          currentPrice: { type: 'number', nullable: true, example: 563.48 },
          changePercent: { type: 'number', nullable: true, example: 1.24 },
          lastTradeDate: { type: 'string', format: 'date-time', nullable: true },
          lastSyncedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      SearchResult: {
        type: 'object',
        properties: {
          symbol: { type: 'string', example: 'FFC' },
          companyName: { type: 'string', nullable: true },
          currentPrice: { type: 'number', nullable: true },
          lastSyncedAt: { type: 'string', format: 'date-time', nullable: true },
          lastTradeDate: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      IndexSummary: {
        type: 'object',
        description:
          'Latest index reading. `high`/`low` are always null: the DPS index series provides close, open and ' +
          'volume per day only. `lastTradeDate` is the intraday timestamp when the value comes from a live ' +
          'reading, otherwise the daily trade date.',
        properties: {
          symbol: { type: 'string', example: 'KSE100' },
          name: { type: 'string', example: 'KSE-100 Index' },
          value: { type: 'number', nullable: true, example: 167970.65 },
          change: { type: 'number', nullable: true, example: -2541.2, description: 'value − previousClose.' },
          changePercent: { type: 'number', nullable: true, example: -1.4903 },
          open: { type: 'number', nullable: true, example: 169830.1135 },
          high: { type: 'number', nullable: true, description: 'Always null for indices.' },
          low: { type: 'number', nullable: true, description: 'Always null for indices.' },
          previousClose: { type: 'number', nullable: true, example: 170511.85 },
          volume: { type: 'number', nullable: true, example: 232943686 },
          lastTradeDate: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      Price: {
        type: 'object',
        properties: {
          currentPrice: { type: 'number', nullable: true },
          change: { type: 'number', nullable: true },
          changePercent: { type: 'number', nullable: true },
          volume: { type: 'number', nullable: true },
          high: { type: 'number', nullable: true },
          low: { type: 'number', nullable: true },
          open: { type: 'number', nullable: true },
          close: { type: 'number', nullable: true },
          marketCap: { type: 'number', nullable: true },
          lastTradeDate: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      PriceRow: {
        type: 'object',
        properties: {
          currentPrice: { type: 'number', nullable: true },
          open: { type: 'number', nullable: true },
          high: { type: 'number', nullable: true },
          low: { type: 'number', nullable: true },
          close: { type: 'number', nullable: true },
          volume: { type: 'number', nullable: true },
          lastTradeDate: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      Ratios: {
        type: 'object',
        properties: {
          peRatio: { type: 'number', nullable: true },
          pbRatio: { type: 'number', nullable: true },
          roe: { type: 'number', nullable: true },
          roa: { type: 'number', nullable: true },
          dividendYield: { type: 'number', nullable: true },
          beta: { type: 'number', nullable: true },
        },
      },
      Financial: {
        type: 'object',
        properties: {
          year: { type: 'integer', example: 2024 },
          quarter: { type: 'integer', nullable: true, example: 4 },
          eps: { type: 'number', nullable: true },
          sales: { type: 'number', nullable: true },
          profitAfterTax: { type: 'number', nullable: true },
          assets: { type: 'number', nullable: true },
          liabilities: { type: 'number', nullable: true },
          equity: { type: 'number', nullable: true },
        },
      },
      Dividend: {
        type: 'object',
        properties: {
          announcementDate: { type: 'string', format: 'date-time', nullable: true },
          bookClosure: { type: 'string', format: 'date-time', nullable: true },
          paymentDate: { type: 'string', format: 'date-time', nullable: true },
          dividend: { type: 'number', nullable: true },
        },
      },
      StockDetail: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          symbol: { type: 'string', example: 'FFC' },
          companyName: { type: 'string', nullable: true },
          sector: { type: 'string', nullable: true },
          price: { allOf: [{ $ref: '#/components/schemas/Price' }], nullable: true },
          ratios: { allOf: [{ $ref: '#/components/schemas/Ratios' }], nullable: true },
          financials: { type: 'array', items: { $ref: '#/components/schemas/Financial' } },
          dividends: { type: 'array', items: { $ref: '#/components/schemas/Dividend' } },
          lastSync: {
            type: 'object', nullable: true,
            properties: {
              status: { $ref: '#/components/schemas/SyncStatusEnum' },
              startedAt: { type: 'string', format: 'date-time' },
              completedAt: { type: 'string', format: 'date-time', nullable: true },
            },
          },
        },
      },
      SyncLog: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          symbol: { type: 'string', nullable: true, example: 'FFC' },
          status: { $ref: '#/components/schemas/SyncStatusEnum' },
          startedAt: { type: 'string', format: 'date-time' },
          completedAt: { type: 'string', format: 'date-time', nullable: true },
          durationMs: { type: 'integer', nullable: true, example: 5087 },
          errorMessage: { type: 'string', nullable: true },
        },
      },
      JobRef: {
        type: 'object',
        properties: {
          jobId: { type: 'string', example: 'sync-FFC' },
          symbol: { type: 'string', example: 'FFC' },
          range: { $ref: '#/components/schemas/HistoryRange' },
          reused: { type: 'boolean', example: false },
          state: { type: 'string', example: 'waiting' },
        },
      },
      HistoryJobStatus: {
        type: 'object',
        properties: {
          jobId: { type: 'string', nullable: true },
          state: { type: 'string', example: 'active', description: 'none | waiting | active | delayed | completed | failed' },
          progress: {
            type: 'object', nullable: true,
            properties: { percent: { type: 'integer', example: 60 }, note: { type: 'string', example: 'persisting' } },
          },
          returnValue: {
            type: 'object', nullable: true,
            properties: { fetched: { type: 'integer' }, persisted: { type: 'integer' } },
          },
          failedReason: { type: 'string', nullable: true },
        },
      },
      SyncStatus: {
        type: 'object',
        properties: {
          queues: { type: 'object', additionalProperties: { type: 'object', additionalProperties: { type: 'integer' } } },
          inFlight: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;
