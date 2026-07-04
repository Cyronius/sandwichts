"""SW-DEMO-E2E mock-mode flows: full loop (model->sandbox->board->transcript->prose)
in a real browser with the scripted fake client (?mock=1), plus watchdog recovery."""
import sys
from playwright.sync_api import sync_playwright

results = []

def check(name, ok, detail=''):
    results.append((name, ok))
    print((('PASS' if ok else 'FAIL') + f'  {name}  {detail[:200]}').encode('ascii', 'replace').decode())

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://localhost:5173/?mock=1')
    page.wait_for_load_state('networkidle')

    # Baseline: Doing column has 1 card.
    doing = page.locator('[data-testid="col-doing"] .card')
    check('baseline: Doing has 1 card', doing.count() == 1, f'count={doing.count()}')

    # Enable dev reveal so we can inspect transcript + code peek.
    page.locator('.dev-toggle input').check()

    # Flow 1: happy path — three pastel cards land on the board live.
    page.locator('[data-testid="chat-input"]').fill('Add three pastel launch-prep cards to Doing')
    page.locator('button:has-text("Send")').click()
    page.wait_for_function("document.querySelectorAll('[data-testid=\"col-doing\"] .card').length === 4", timeout=15000)
    check('flow1: three cards added to Doing', True)

    # Final prose bubble renders; code block hidden from prose but present in code peek.
    page.wait_for_selector('text=Done! I added three pastel launch-prep cards', timeout=10000)
    bubbles = page.locator('.bubble.assistant')
    texts = [bubbles.nth(i).inner_text() for i in range(bubbles.count())]
    check('flow1: final prose rendered', any('Done! I added' in t for t in texts))
    check('flow1: no raw ```js in prose', all('```js' not in t.split('code (')[0] for t in texts))
    peek = page.locator('.code-peek')
    check('flow1: dev code peek present', peek.count() >= 1)

    # Transcript dev panel shows the executed calls.
    transcript = page.locator('[data-testid="transcript"]')
    ttxt = transcript.inner_text() if transcript.count() else ''
    check('flow1: transcript shows get_board + add_card calls',
          'get_board' in ttxt and ttxt.count('add_card') == 3, ttxt[:150])

    # Input unlocked again (wait: running flips false just after the prose commit).
    page.wait_for_function("!document.querySelector('[data-testid=\"chat-input\"]').disabled", timeout=5000)
    check('flow1: input unlocked', True)

    # Flow 2: watchdog — while(true) script times out (3s) and loop recovers.
    page.locator('[data-testid="chat-input"]').fill('now run something that loops forever')
    page.locator('button:has-text("Send")').click()
    page.wait_for_selector('text=watchdog terminated it', timeout=25000)
    check('flow2: watchdog recovery prose rendered', True)
    check('flow2: input unlocked after watchdog', page.locator('[data-testid="chat-input"]').is_enabled())
    check('no page errors', not errors, '; '.join(errors[:2]))

    page.screenshot(path=r'C:\Users\josha\AppData\Local\Temp\claude\c--code-frontend-code-mode\55f2b721-95ef-49cf-92b6-5eb1ed9bff54\scratchpad\taskboard_mock.png', full_page=True)
    browser.close()

fails = [r for r in results if not r[1]]
print(f'\n{len(results)-len(fails)}/{len(results)} passed')
sys.exit(1 if fails else 0)
