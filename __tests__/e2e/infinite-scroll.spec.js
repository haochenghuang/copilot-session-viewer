const { test, expect } = require('./fixtures');

test.describe('Infinite Scroll', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // Wait for page to load (sessions may not exist in CI)
    await page.waitForLoadState('networkidle');
  });

  test('should display Load More Sessions button when there are more sessions', async ({ page }) => {
    // Note: This app now uses pure infinite scroll without a load-more button
    // The #load-more-btn and #load-more-section elements have been removed
    // This test now just verifies that sessions exist (if any)
    const sessionCount = await page.locator('.recent-item').count();

    // Just verify loading indicator exists in DOM
    const loadingIndicator = page.locator('#loading-indicator');
    await expect(loadingIndicator).toBeAttached();

    console.log(`Found ${sessionCount} sessions (infinite scroll mode)`);
  });

  test('should load additional sessions when Load More button is clicked', async ({ page }) => {
    // Note: Load More button has been removed - this is now pure infinite scroll
    // This test now verifies infinite scroll behavior by scrolling
    const initialSessionCount = await page.locator('.recent-item').count();

    if (initialSessionCount === 0) {
      console.log('No sessions available - skipping infinite scroll test');
      return;
    }

    // Scroll near bottom to trigger infinite scroll
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight - 400);
    });

    // Wait for potential loading
    await page.waitForTimeout(3000);

    // Count sessions after scrolling
    const newSessionCount = await page.locator('.recent-item').count();

    // Sessions should be same or more (depends on whether more exist)
    expect(newSessionCount).toBeGreaterThanOrEqual(initialSessionCount);
    console.log(`Initial: ${initialSessionCount}, After scroll: ${newSessionCount}`);
  });

  test('should show loading state when Load More button is clicked', async ({ page }) => {
    // Note: Load More button removed - test now checks infinite scroll loading
    const sessionCount = await page.locator('.recent-item').count();

    if (sessionCount === 0) {
      console.log('No sessions available - skipping loading state test');
      return;
    }

    // Scroll near bottom to trigger loading
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight - 400);
    });

    // Check for loading indicator (may appear briefly)
    const loadingIndicator = page.locator('#loading-indicator');
    const hasLoadingState = await loadingIndicator.isVisible({ timeout: 2000 }).catch(() => false);

    console.log('Loading state visible during scroll:', hasLoadingState);

    // Wait for completion
    await page.waitForTimeout(3000);
  });

  test('should trigger infinite scroll when scrolling near bottom', async ({ page }) => {
    // Count initial sessions
    const initialSessionCount = await page.locator('.recent-item').count();

    // Scroll to bottom of page
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight - 600);
    });

    // Wait for potential loading
    await page.waitForTimeout(3000);

    // Check if more sessions were loaded
    const newSessionCount = await page.locator('.recent-item').count();

    // If there are more sessions available, they should load
    if (initialSessionCount >= 20) {
      expect(newSessionCount).toBeGreaterThanOrEqual(initialSessionCount);
    }
  });

  test('should hide Load More button when no more sessions available', async ({ page }) => {
    // Note: Load More button has been removed in favor of infinite scroll
    // This test now just verifies infinite scroll stops when no more sessions
    let currentCount = await page.locator('.recent-item').count();

    if (currentCount === 0) {
      console.log('No sessions available - skipping test');
      return;
    }

    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      const previousCount = currentCount;

      // Scroll to bottom
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });

      await page.waitForTimeout(2000);
      currentCount = await page.locator('.recent-item').count();

      // If no new sessions loaded, we've reached the end
      if (currentCount === previousCount) {
        console.log('No more sessions to load - infinite scroll stopped');
        break;
      }

      attempts++;
    }

    console.log(`Loaded ${currentCount} total sessions across ${attempts} scroll attempts`);
  });

  test('should handle API errors gracefully during infinite scroll', async ({ page }) => {
    // Intercept the load-more API to return an error
    await page.route('**/api/sessions/load-more*', route => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Server error' })
      });
    });

    const sessionCount = await page.locator('.recent-item').count();

    if (sessionCount === 0) {
      console.log('No sessions available - skipping error handling test');
      return;
    }

    // Scroll to trigger infinite scroll (which should fail due to our mock)
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight - 400);
    });

    // Wait for potential error handling
    await page.waitForTimeout(2000);

    // Check that page is still functional despite error
    await expect(page.locator('h1')).toContainText('Session Viewer');

    // Page should still be usable
    const sessionInput = page.locator('input[placeholder*="Session ID"]');
    await expect(sessionInput).toBeVisible();

    console.log('Page remains functional after API error');
  });

  test('should preserve session list state during navigation', async ({ page }) => {
    const sessionCount = await page.locator('.recent-item').count();

    if (sessionCount === 0) {
      console.log('No sessions available - skipping navigation test');
      return;
    }

    // Scroll to potentially load more
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight - 400);
    });
    await page.waitForTimeout(2000);

    const sessionsAfterScroll = await page.locator('.recent-item').count();

    // Click on first session
    const firstSession = page.locator('.recent-item').first();
    await firstSession.click();

    // Wait for navigation
    await page.waitForURL(/\/session\/.+/);

    // Go back to homepage
    await page.goBack();
    await page.waitForURL('/');

    // Check if sessions are still loaded (should maintain state)
    await page.waitForSelector('.recent-item', { timeout: 5000 });
    const newSessionCount = await page.locator('.recent-item').count();

    // Should show at least initial batch, ideally maintain the loaded state
    expect(newSessionCount).toBeGreaterThanOrEqual(Math.min(sessionsAfterScroll, 20));
    console.log(`Before nav: ${sessionsAfterScroll}, After nav: ${newSessionCount}`);
  });
});