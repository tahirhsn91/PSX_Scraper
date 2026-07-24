# PSX Stock Data Scraper & Portfolio Backend

## Objective

Build a production-ready full-stack application for collecting,
scraping, storing, and managing Pakistan Stock Exchange (PSX) stock
information.

The solution should follow Clean Architecture, SOLID principles, and be
modular, scalable, and production-ready.

------------------------------------------------------------------------

# Technology Stack

## Backend

-   Node.js (Latest LTS)
-   Express.js
-   TypeScript
-   PostgreSQL
-   Prisma ORM
-   Puppeteer (preferred) or Playwright
-   BullMQ + Redis
-   Docker
-   Docker Compose

## Frontend

-   React
-   TypeScript
-   Vite
-   React Query (TanStack Query)
-   React Router
-   Material UI
-   Axios

## Database

-   PostgreSQL

## Infrastructure

-   Docker Compose
-   Redis
-   PostgreSQL

------------------------------------------------------------------------

# Websites to Scrape

## Website 1

https://dps.psx.com.pk/company/{SYMBOL}

Example:

https://dps.psx.com.pk/company/FFC

## Website 2

https://sarmaaya.pk/stocks/{SYMBOL}

Example:

https://sarmaaya.pk/stocks/FFC

The application should support any PSX symbol.

------------------------------------------------------------------------

# High-Level Architecture

``` text
React UI
      |
REST APIs
      |
Node Backend
      |
----------------------------
| Search Service
| Stock Service
| Scraper Service
| Scheduler
| Background Jobs
----------------------------
      |
PostgreSQL

Background Worker
        |
Puppeteer Scraper
        |
PSX Website
Sarmaaya Website
```

------------------------------------------------------------------------

# Features

## 1. Stock Search

-   Search stocks by symbol
-   Display company name
-   Current price
-   Latest synced date
-   Last trading date

Clicking a stock opens the Stock Details page.

------------------------------------------------------------------------

## 2. Stock Detail Page

Display:

-   Company information
-   Current price
-   Historical data
-   Financials
-   Ratios
-   Dividend history
-   Last sync status

Include a **Sync Latest Data** button.

When clicked:

-   Start scraping immediately
-   Show progress indicator
-   Refresh UI after completion

------------------------------------------------------------------------

## 3. Automatic Background Sync

Run every hour.

Requirements:

-   Sync every stock
-   Configurable schedule
-   Retry on failure
-   Logging
-   Error handling

------------------------------------------------------------------------

## 4. Add New Stock

### API

``` http
POST /stocks
```

Request:

``` json
{
  "symbol": "FFC"
}
```

Process:

-   Validate symbol
-   Insert stock
-   Scrape complete data
-   Store into PostgreSQL

------------------------------------------------------------------------

# Scraping Requirements

Use Puppeteer.

Create independent scrapers:

-   PSXScraper
-   SarmaayaScraper

Expose:

``` ts
scrape(symbol: string)
```

Never place scraping logic inside controllers.

------------------------------------------------------------------------

# Database Schema

## Stocks

-   id
-   symbol
-   company_name
-   sector
-   created_at
-   updated_at

## Stock Prices

-   id
-   stock_id
-   current_price
-   change
-   change_percent
-   volume
-   high
-   low
-   open
-   close
-   market_cap
-   last_trade_date
-   created_at

## Dividends

-   id
-   stock_id
-   announcement_date
-   book_closure
-   payment_date
-   dividend
-   created_at

## Financials

-   id
-   stock_id
-   year
-   quarter
-   eps
-   sales
-   profit_after_tax
-   assets
-   liabilities
-   equity
-   created_at

## Ratios

-   id
-   stock_id
-   pe_ratio
-   pb_ratio
-   roe
-   roa
-   dividend_yield
-   beta
-   created_at

## Sync Logs

-   id
-   stock_id
-   status
-   started_at
-   completed_at
-   duration
-   error_message

------------------------------------------------------------------------

# Backend APIs

## Stocks

-   GET /stocks
-   GET /stocks/:symbol
-   POST /stocks
-   DELETE /stocks/:symbol
-   POST /stocks/:symbol/sync
-   GET /stocks/:symbol/history

## Search

-   GET /search?q=FFC

## Sync

-   POST /sync/all
-   GET /sync/status
-   GET /sync/logs

------------------------------------------------------------------------

# Backend Structure

``` text
src/
├── controllers
├── services
├── repositories
├── scrapers
├── jobs
├── workers
├── routes
├── middleware
├── config
├── database
├── prisma
├── validators
├── utils
└── types
```

------------------------------------------------------------------------

# Frontend Pages

-   Dashboard
-   Search Results
-   Stock Details
-   Sync Logs

Use:

-   React Query
-   React Router
-   Axios
-   Context API
-   Material UI
-   Responsive UI
-   Dark Mode

------------------------------------------------------------------------

# Background Jobs

Use BullMQ.

Queues:

-   stock-sync
-   stock-sync-all

Retry:

-   3 attempts
-   Exponential backoff

------------------------------------------------------------------------

# Docker

Services:

-   frontend
-   backend
-   postgres
-   redis

Startup:

``` bash
docker compose up
```

------------------------------------------------------------------------

# Environment Variables

## Backend

``` env
DATABASE_URL=
REDIS_URL=
PORT=
SCRAPER_TIMEOUT=
CRON_EXPRESSION=
LOG_LEVEL=
```

## Frontend

``` env
VITE_API_URL=
```

------------------------------------------------------------------------

# Logging

Use Winston.

Log:

-   API requests
-   Scraping
-   Cron executions
-   Errors
-   Performance metrics

------------------------------------------------------------------------

# Error Handling

Handle:

-   Website unavailable
-   Network timeout
-   Invalid symbol
-   HTML changes
-   Database failures
-   Duplicate records

Retry automatically where appropriate.

------------------------------------------------------------------------

# Performance

-   Concurrent scraping with configurable limits
-   Prevent duplicate jobs
-   Cache search results
-   Optimize database indexes

------------------------------------------------------------------------

# Code Quality

-   TypeScript
-   ESLint
-   Prettier
-   Husky
-   Conventional Commits
-   Repository Pattern
-   Service Pattern
-   DTOs
-   Zod validation

------------------------------------------------------------------------

# Testing

-   Unit Tests
-   Integration Tests
-   Scraper Tests
-   API Tests

Framework:

-   Jest

------------------------------------------------------------------------

# Documentation

Generate:

-   README.md
-   Installation Guide
-   Docker Setup
-   API Documentation (Swagger/OpenAPI)
-   ER Diagram
-   Architecture Diagram
-   Sequence Diagram
-   Deployment Guide

------------------------------------------------------------------------

# Future Extensibility

Design a pluggable scraper framework so new data providers can be added
by implementing a common scraper interface without changing business
logic.

------------------------------------------------------------------------

# Deliverables

1.  Backend (Node.js + TypeScript + Express)
2.  Frontend (React + Vite + TypeScript)
3.  PostgreSQL schema (Prisma)
4.  Puppeteer scrapers
5.  BullMQ workers
6.  Docker & Docker Compose
7.  API documentation
8.  Unit & Integration tests
9.  Logging, validation & error handling
10. Production-ready, scalable architecture
