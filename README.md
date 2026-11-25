# MathScope 0.1

A Chrome extension that makes equations on Wikipedia interactive. It outlines
every formula it can plot. Click one to get a plot, sliders for the other
symbols, and a symbolic derivative.

![MathScope opening an equation, moving its sliders and reading the plot](docs/demo.gif)

*Recorded on a sample article that uses Wikipedia's formula markup.*

## Install (desktop Chrome, Edge or Brave)

1. Download this repository: **Code > Download ZIP** on GitHub, then unzip it
   (or `git clone https://github.com/vinodhalaharvi/wikipedia-mathscope.git`).
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the folder that contains `manifest.json`.
5. Open a Wikipedia article with formulas, for example
   `https://en.wikipedia.org/wiki/Gaussian_function`, and reload it.

A badge at the bottom left reports how many equations can plot. Each of those gets a
blue "Plot" pill and a
dashed blue outline. Click the pill or the equation to open the panel.
Press Esc or **Close** to dismiss it.

## What it handles

- Formulas written as `name(variable) = expression` or `name = expression`.
- One variable on the horizontal axis. Every other symbol becomes a slider.
- Real-valued arithmetic, powers, roots, exp, logs and trigonometric functions.

It skips, on purpose: functions of two or more inputs, integrals, sums and
limits, piecewise definitions, complex-valued expressions, and inline formulas
that Wikipedia writes as plain text instead of TeX.

## How it works

| File | Role |
| --- | --- |
| `content.js`, `content.css` | Runs on the page. Reads each formula's TeX source, outlines the plottable ones, hosts the panel iframe. |
| `panel.html`, `panel.js`, `panel.css` | The panel. Parses TeX, classifies, differentiates, evaluates and draws. |
| `vendor/compute-engine` | Cortex Compute Engine 0.173.0 (MIT). TeX parsing and symbolic derivatives. |
| `vendor/katex` | KaTeX 0.19.1 (MIT). Renders formulas in the panel as MathML. |

The extension requests no permissions, makes no network requests, and only
runs on `*.wikipedia.org`. Nothing on Wikipedia itself is changed.

## Known limits

- The adapter was checked against live Wikipedia articles in November 2026. If
  Wikipedia changes its formula markup again and nothing is outlined, the adapter in
  `content.js` (`texOf`) is the place to look.
- Slider ranges are fixed at −5 to 5 and starting values are guesses.
- `γ` and `φ` are treated as variables, `e`, `i` and `π` as constants.
- Derivatives are correct but not tidied into their shortest form.

## License

MIT, see `LICENSE`. The bundled libraries in `vendor/` keep their own MIT
licenses, included beside each one.
