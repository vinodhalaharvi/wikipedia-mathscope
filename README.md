# MathScope 0.5

A Chrome extension that makes equations on the web interactive. It marks every
formula it can draw. Click one to get a plot with sliders for its symbols:
curves, surfaces, vector fields and 3D shapes.

## Where it works

| Site | How |
| --- | --- |
| Wikipedia, Wikibooks, Wikiversity | Automatic |
| arXiv HTML papers (`arxiv.org/html/…`) | Automatic |
| Stack Exchange sites and MathOverflow | Automatic |
| ChatGPT and Claude | Automatic, and it keeps up as new answers arrive |
| Any other page that renders math with KaTeX, MathJax or MathML | Click the MathScope toolbar button on that page |

It reads the TeX source that each renderer leaves in the page, so it works per
rendering technology, not per website. Pages that show math as images, plain
text or PDF have no source to read and are not supported.

![MathScope opening an equation, moving its sliders and reading the plot](docs/demo.gif)

*Recorded with version 0.1 on a sample article that uses Wikipedia's formula markup.*

[Watch the 30-second demo video with sound](docs/mathscope-demo.mp4) (opens GitHub's video player).

## Install (desktop Chrome, Edge or Brave)

1. Download this repository: **Code > Download ZIP** on GitHub, then unzip it
   (or `git clone https://github.com/vinodhalaharvi/wikipedia-mathscope.git`).
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the folder that contains `manifest.json`.
5. Open a Wikipedia article with formulas, for example
   `https://en.wikipedia.org/wiki/Gaussian_function`, and reload it.
6. Optional: pin MathScope from the puzzle-piece menu, so its button is one click away
   on sites outside the automatic list.

A badge at the bottom left reports how many equations can plot. Each of those gets a
blue "Plot" pill and a
dashed blue outline. Click the pill or the equation to open the panel.
Press Esc or **Close** to dismiss it.

## What it draws

| Pill | Formula shape | What you get |
| --- | --- | --- |
| Plot | `f(x) = …` or `name = …` | A curve with its derivative. Complex results show real and imaginary parts. |
| Surface | `f(x, y) = …`, `z = …` | A colour map with contour lines, or a 3D surface you can rotate. |
| Curve | `x² + y² = r²` and similar | The curve where both sides are equal. |
| Field | `F = y î − x ĵ`, `F(x, y) = (−y, x)` | Arrows, coloured by curl, divergence or strength. |
| 3D field | fields with three components | Arrows in a box you can rotate. Can show the curl instead. |
| Shape, 3D shape | `x = …, y = …, (z = …)` given together | The curve or surface they trace, such as a sphere from spherical coordinates. |

Every symbol that is not on an axis becomes a slider.

## Operators

Under each plot is a row of operators. Each takes what is on screen and turns it
into something new, which you can then operate on again. A trail at the top shows
the steps; click an earlier step to go back. Sliders keep their values across steps.

| On | Operator | Result |
| --- | --- | --- |
| Curve | Derivative | Curve |
| Curve | Integral (from 0 up to each point) | Curve |
| Curve | Fourier spectrum (strength of each frequency) | Curve |
| Curve | Taylor approximation, with sliders for order and centre | Curve, drawn over the original |
| Surface | Gradient | Field |
| Surface | Laplacian | Surface |
| Field | Divergence | Surface |
| Field | Curl | Surface in 2D, field in 3D |

So `surface → Gradient → Divergence` gives the same picture as `surface → Laplacian`,
and `field → Curl → Divergence` is zero everywhere.

Derivatives are worked out symbolically when the formula allows it, and the result
is shown as a formula. Otherwise they are estimated numerically, up to the fourth
derivative. Each curve also shows three whole-curve numbers: its area, its average
and its smoothness energy (half the integral of the squared slope).

It also understands:

- Several definitions in one formula (rows of an aligned block, or separated by commas).
- Piecewise definitions written with cases.
- erf, the gamma function, factorials, floor, absolute value, min and max.
- Sums and definite integrals, evaluated numerically. Infinite sums get a "terms" slider.
- Functions defined elsewhere on the same page: `Q(x) = 1 − Φ(x)` works when the
  article also defines Φ.

It skips: limits, derivatives and differential equations, matrices, sums over
indexed data such as `Σ xᵢ`, and inline formulas written as plain text instead
of TeX. It also leaves simple relations unmarked, such as `x = μ − σ` or
`X = σZ + μ`: a name set equal to plain arithmetic where each symbol appears once.
Explicit functions like `f(x) = ax + b` are always marked.

## How it works

| File | Role |
| --- | --- |
| `content.js`, `content.css` | Runs on the page. One adapter per renderer (Wikipedia, KaTeX, MathJax 2, MathJax 3+, MathML) reads each formula's TeX source. Marks the drawable ones and hosts the panel iframe. |
| `page-mathjax.js` | Runs in the page's own script world on MathJax 3+ sites, where the TeX source lives in memory. Copies it onto each formula as an attribute. |
| `background.js` | Runs MathScope on the current tab when the toolbar button is clicked. |
| `math.js` | Splits and classifies formulas, and evaluates them by walking the parsed tree. No generated code, as Manifest V3 requires. |
| `ops.js` | The operators. Each maps one drawable object to another, so they chain. |
| `plots.js` | Draws curves and maps on a plain canvas, plus a simple 3D fallback. |
| `plots3d.js` | The 3D views (surfaces, 3D fields, space curves, shapes), drawn with Three.js. Rotate by dragging, zoom by scrolling. |
| `panel.html`, `panel.js`, `panel.css` | The panel: controls, sliders and readouts. |
| `vendor/compute-engine` | Cortex Compute Engine 0.173.0 (MIT). TeX parsing and symbolic derivatives. |
| `vendor/katex` | KaTeX 0.19.1 (MIT). Typesets formulas in the panel. |
| `vendor/three` | Three.js 0.187.0 (MIT), bundled down to the parts used. Rebuild with `esbuild vendor/three/entry.js --bundle --format=esm --minify` after `npm install three`. |

Permissions: the extension runs automatically only on the sites listed above.
Everywhere else it does nothing until you click its button, which grants access
to that one tab (`activeTab`). It makes no network requests and sends nothing
anywhere. The page you see gains pills, outlines and a side panel; the site
itself is not changed.

## Known limits

- Checked against live pages in November 2026: Wikipedia and arXiv HTML. The
  KaTeX and MathJax adapters were tested with the real libraries on local pages,
  but not on ChatGPT, Claude or Stack Exchange themselves. If a site changes its
  markup and nothing is marked, look at the adapters in `content.js`.
- On AI chats the pill is drawn with CSS and nothing is inserted into the page,
  so the chat app's own rendering is left alone.
- The same letter can mean different things in different sections of an article.
  A cross-reference always uses the first definition on the page, which is
  sometimes the wrong one.
- The Fourier spectrum uses the function between −10 and 10 only, so a wave that
  never dies away shows broad peaks, not sharp spikes.
- Integrals to infinity are cut off at ±10, and infinite sums are truncated, so
  both are approximations. A truncated series goes wrong far from its centre.
- Slider ranges are fixed at −5 to 5 and starting values are guesses.
- `γ` and `φ` are treated as variables, `e`, `i` and `π` as constants.
- Symbolic derivatives are correct but not tidied into their shortest form.
- The 3D views need WebGL. Where it is unavailable, a simpler canvas drawing is
  used: it rotates but does not zoom, and folded shapes can show ordering glitches.

## License

MIT, see `LICENSE`. The bundled libraries in `vendor/` keep their own MIT
licenses, included beside each one.
