import puppeteer, { Browser, Page } from 'puppeteer';
import { env } from '../config';
import { logger } from '../utils/logger';

/** Shared, lazily-launched browser with a simple concurrency semaphore. */
class BrowserPool {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private active = 0;
  private queue: Array<() => void> = [];

  /**
   * Launches Chromium with a hard timeout. Without this, a launch that hangs
   * (under-provisioned memory/CPU — e.g. Render's free 512MB/0.1 CPU instance)
   * never resolves or rejects, so callers wait forever and the concurrency
   * slot acquired in `withPage` is never released — one hung launch then
   * permanently blocks every future sync job behind it.
   */
  private async launchBrowser(): Promise<Browser> {
    const launchPromise = puppeteer.launch({
      headless: true,
      executablePath: env.PUPPETEER_EXECUTABLE_PATH,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        // Reduces Chromium's process/memory footprint — helps on very
        // constrained instances, at some cost to crash isolation.
        '--single-process',
        '--no-zygote',
      ],
    });

    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Browser launch timed out after ${env.BROWSER_LAUNCH_TIMEOUT}ms`)),
        env.BROWSER_LAUNCH_TIMEOUT,
      );
    });

    try {
      const browser = await Promise.race([launchPromise, timeout]);
      clearTimeout(timer!);
      logger.info('browser.launched');
      return browser;
    } catch (err) {
      clearTimeout(timer!);
      // If the launch eventually resolves after we've given up on it, close
      // the orphaned browser instead of leaking a Chromium process forever.
      launchPromise.then((b) => b.close().catch(() => undefined)).catch(() => undefined);
      logger.error('browser.launch_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.connected) return this.browser;
    // De-dupe concurrent launch attempts instead of racing multiple `puppeteer.launch()` calls.
    if (!this.launching) {
      this.launching = this.launchBrowser()
        .then((b) => {
          this.browser = b;
          b.once('disconnected', () => {
            if (this.browser === b) this.browser = null;
          });
          return b;
        })
        .finally(() => {
          this.launching = null;
        });
    }
    return this.launching;
  }

  private async acquireSlot(): Promise<void> {
    if (this.active < env.SCRAPER_CONCURRENCY) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
  }

  private releaseSlot(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  /**
   * Run a task with a fresh, isolated page. The concurrency slot is acquired
   * and released around the ENTIRE lifecycle (browser launch included) so a
   * failed or timed-out launch always releases it — previously the slot was
   * only released in a `finally` that sat *after* the launch, so a hung
   * launch permanently starved the pool.
   */
  async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    await this.acquireSlot();
    try {
      const browser = await this.getBrowser();
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1366, height: 900 });
        await page.setUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        );
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const type = req.resourceType();
          if (['image', 'font', 'media', 'stylesheet'].includes(type)) req.abort();
          else req.continue();
        });
        page.setDefaultNavigationTimeout(env.SCRAPER_TIMEOUT);
        return await fn(page);
      } finally {
        await page.close().catch(() => undefined);
      }
    } finally {
      this.releaseSlot();
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }
  }
}

export const browserPool = new BrowserPool();
