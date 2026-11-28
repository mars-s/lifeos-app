"""Shoots and drives /design/genui: the GenUI grammar and the sealed frame.

Set BASE to the running web app. Needs Playwright with Chromium.

    BASE=http://localhost:3990 uv run --with playwright python scripts/check-genui-design.py <output folder>

Writes genui-<section>.png, -dark, -phone and -phone-dark, then checks that the two
layers cannot be told apart by measuring them, that a frame is sealed, and that
values, tools, themes and streaming work in both.
"""

import os
import re
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("BASE", "http://localhost:3990")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
SECTIONS = ["asks", "mixed", "states", "phone", "seam"]
SIZES = {"desktop": (1440, 4600, 1), "phone": (390, 9000, 2)}
FRAMED = ["dice-roller", "spinning-logo", "breathing", "noughts-and-crosses", "signature"]
STYLE = """
const one = (node) => { const s = getComputedStyle(node); return [s.fontFamily, s.fontSize, s.lineHeight, s.color, s.backgroundColor, s.borderRadius, s.fontWeight].join(' | '); };
"""


def open_board(browser, width, height, scale, theme):
    context = browser.new_context(viewport={"width": width, "height": height}, color_scheme=theme, device_scale_factor=scale)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.goto(f"{BASE}/design/genui")
    page.wait_for_load_state("networkidle")
    expect(page.get_by_role("heading", name="Eighteen asks, one small model", exact=True)).to_be_visible()
    page.add_style_tag(content="header.sticky { position: static !important; } [data-toaster] { visibility: hidden !important; }")
    expect(page.locator("iframe[data-genui-frame].opacity-100")).to_have_count(8)
    page.wait_for_timeout(900)
    return context, page, errors


def frame_of(page, ask):
    return page.frame_locator(f'[data-ask="{ask}"] iframe')


def shoot(page, suffix):
    overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    assert overflow <= 0, f"the page scrolls sideways by {overflow}px"
    page.locator("section[aria-labelledby=direction]").screenshot(path=str(OUT / f"genui-direction{suffix}.png"))
    for section in SECTIONS:
        target = page.locator(f"#{section}")
        target.scroll_into_view_if_needed()
        if section == "states":
            for block in target.get_by_role("button", name="Draw Today again").all():
                block.click()
            page.wait_for_timeout(700)
            expect(target.locator(".gu-ghost").first).to_be_visible()
        page.wait_for_timeout(300)
        target.screenshot(path=str(OUT / f"genui-{section}{suffix}.png"))


def check_layers(page):
    assert page.locator("[data-asks] [data-genui-block]").count() == 18
    assert page.locator('[data-asks] [data-genui-block][data-layer="3"]').count() == 5
    assert page.get_by_role("alert").count() == 1, "only the Not valid specimen may fail the schema"
    for ask in FRAMED:
        expect(page.locator(f'[data-ask="{ask}"] iframe')).to_have_attribute("sandbox", "allow-scripts")
    expect(page.locator("[data-asks]").get_by_text("Sealed frame")).to_have_count(0)
    page.get_by_role("radio", name="Shown").click()
    expect(page.locator("[data-asks]").get_by_text("Sealed frame")).to_have_count(5)
    page.get_by_role("radio", name="Hidden").click()


def check_same_pixels(page):
    host = page.locator('[data-ask="inbox-capture"]')
    frame = frame_of(page, "dice-roller")
    pairs = [(".gu-num-label", ".gu-num-label"), (".gu-num", ".gu-num"), ("button", "button"), (".gu-unit", None)]
    for mine, theirs in pairs:
        if theirs is None:
            continue
        a = host.locator(f".gu {mine}").first.evaluate(f"(node) => {{ {STYLE} return one(node); }}")
        b = frame.locator(theirs).first.evaluate(f"(node) => {{ {STYLE} return one(node); }}")
        assert a == b, f"{mine} differs between the layers:\n app   {a}\n frame {b}"
    loading = page.locator("#states")
    grammar = loading.locator("article").filter(has=page.get_by_role("heading", name="Loading, grammar")).locator(".gu table td").first
    sealed = loading.locator("article").filter(has=page.get_by_role("heading", name="Loading, sealed frame")).frame_locator("iframe").locator("table td").first
    expect(sealed).to_be_visible(timeout=6000)
    a = grammar.evaluate(f"(node) => {{ {STYLE} return one(node) + node.getBoundingClientRect().height; }}")
    b = sealed.evaluate(f"(node) => {{ {STYLE} return one(node) + node.getBoundingClientRect().height; }}")
    assert a == b, f"a table cell differs between the layers:\n app   {a}\n frame {b}"


def check_sealed(page):
    frame = frame_of(page, "dice-roller")
    assert page.locator('[data-ask="dice-roller"] iframe').evaluate("(node) => { try { return node.contentDocument === null; } catch { return true; } }"), "the page can read the frame"
    blocked = frame.locator("body").evaluate(
        """async () => {
          const tries = {};
          try { await fetch('https://example.com'); tries.fetch = 'open'; } catch { tries.fetch = 'blocked'; }
          try { localStorage.setItem('a', '1'); tries.storage = 'open'; } catch { tries.storage = 'blocked'; }
          try { tries.parent = String(parent.document.title); } catch { tries.parent = 'blocked'; }
          try { tries.cookie = document.cookie === '' ? 'empty' : 'open'; } catch { tries.cookie = 'blocked'; }
          return tries;
        }"""
    )
    assert blocked == {"fetch": "blocked", "storage": "blocked", "parent": "blocked", "cookie": "blocked"}, blocked


def check_frames_work(page):
    dice = frame_of(page, "dice-roller")
    dice.get_by_role("button", name="Roll").click()
    expect(dice.locator(".gu-dots")).to_have_attribute("aria-label", re.compile(r"^[1-6]$"))
    game = frame_of(page, "noughts-and-crosses")
    cells = game.locator("#board button")
    for index in [0, 3, 1, 4, 2]:
        cells.nth(index).click()
    expect(game.get_by_text("X wins")).to_be_visible()


def check_values_cross(page):
    block = page.locator("#mixed article").filter(has=page.get_by_role("heading", name="A spiral"))
    slider = block.get_by_role("slider")
    slider.focus()
    for _ in range(3):
        slider.press("ArrowRight")
    expect(block.locator(".gu-dots").first).to_have_attribute("aria-label", "7")
    assert block.frame_locator("iframe").locator("body").evaluate("() => ui.get('speed')") == 7


def check_tools_and_data(page):
    pomodoro = page.locator('[data-ask="pomodoro"]')
    first = pomodoro.locator(".gu-meter-value").inner_text()
    pomodoro.get_by_role("button", name="Stop").click()
    page.wait_for_timeout(2400)
    assert pomodoro.locator(".gu-meter-value").inner_text() != "" and first != ""
    inbox = page.locator('[data-ask="inbox-capture"]')
    before = inbox.locator(".gu-dots").get_attribute("aria-label")
    inbox.get_by_role("button").filter(has_not=page.locator("svg")).click()
    expect(inbox.locator(".gu-dots")).to_have_attribute("aria-label", str(int(before) + 1))


def check_chart_keys(page):
    chart = page.locator('[data-ask="sleep-chart"] .gu-chart')
    chart.focus()
    chart.press("ArrowRight")
    chart.press("ArrowRight")
    expect(chart.locator(".gu-chart-readout")).to_contain_text("Tue")


def check_stream(page):
    block = page.locator('[data-ask="tasks-by-area"]')
    block.get_by_role("button", name="Draw Today by Area again").click()
    expect(block.locator(".gu-ghost").first).to_be_visible()
    expect(block.get_by_text("Draft the methods section")).to_be_visible(timeout=5000)


def check_theme(page):
    frame = frame_of(page, "dice-roller")
    before = frame.locator(".gu-num-label").evaluate("(node) => getComputedStyle(node).color")
    page.get_by_role("radio", name="Dark" if page.evaluate("matchMedia('(prefers-color-scheme: dark)').matches") is False else "Light").click()
    page.wait_for_timeout(300)
    after = frame.locator(".gu-num-label").evaluate("(node) => getComputedStyle(node).color")
    assert before != after, "the frame did not follow the theme"
    host = page.locator('[data-ask="inbox-capture"] .gu-num-label').evaluate("(node) => getComputedStyle(node).color")
    assert host == after, f"after a theme change the layers differ: {host} and {after}"


with sync_playwright() as playwright:
    OUT.mkdir(parents=True, exist_ok=True)
    browser = playwright.chromium.launch()
    for size, (width, height, scale) in SIZES.items():
        for theme in ["light", "dark"]:
            context, page, errors = open_board(browser, width, height, scale, theme)
            suffix = ("" if size == "desktop" else "-phone") + ("" if theme == "light" else "-dark")
            shoot(page, suffix)
            check_layers(page)
            check_same_pixels(page)
            if size == "desktop" and theme == "light":
                check_sealed(page)
                check_frames_work(page)
                check_values_cross(page)
                check_tools_and_data(page)
                check_chart_keys(page)
                check_stream(page)
                check_theme(page)
            refused = [error for error in errors if "Content Security Policy" not in error]
            assert not refused, refused
            context.close()
            print(f"ok {size} {theme}")
    browser.close()
