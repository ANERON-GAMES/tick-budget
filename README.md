# @aneron/tick-budget

Fixed-timestep accumulator for game loops. Each frame it turns elapsed real time into a bounded number of simulation ticks, carries the unused remainder, and returns an interpolation alpha for rendering.

## Purpose

A simulation wants a fixed tick. A display wants to draw whenever a new frame arrives. This package sits between those two rates. You give it the real time that passed since the previous frame and the length of one tick. It tells you how many ticks to run, how far the renderer sits between ticks, and whether a slow frame had to discard time so catch-up work stays bounded.

## Install

```sh
npm install @aneron/tick-budget
```

The package is ESM-only and has no runtime dependencies. It runs on Node 20 and Node 22.

## Usage

Time comes from the caller. Any clock is fine when `elapsed` and `tickLength` share a unit. Skip a frame when the measured delta is not positive. The library rejects that delta.

```js
import { createTickBudget } from "@aneron/tick-budget";

const budget = createTickBudget({
  tickLength: 16,
  maxTicks: 8,
});

let previous = clock();

function frame() {
  const now = clock();
  const elapsed = now - previous;
  previous = now;
  if (elapsed <= 0) {
    return;
  }

  const step = budget.advance(elapsed);
  for (let i = 0; i < step.ticks; i += 1) {
    simulate(16);
  }
  render(step.alpha);
  if (step.dropped) {
    noteSkippedTime(step.droppedTime);
  }
}
```

The same step is available as a pure function. Keep the accumulator yourself and pass it back on the next frame:

```js
import { advance } from "@aneron/tick-budget";

let accumulator = 0;

function frame(elapsed) {
  const step = advance({
    accumulator,
    elapsed,
    tickLength: 16,
    maxTicks: 8,
  });
  accumulator = step.accumulator;
  for (let i = 0; i < step.ticks; i += 1) {
    simulate(16);
  }
  render(step.alpha);
}
```

## API

### `createTickBudget(options)`

Create a budget that stores the accumulator.

- `options.tickLength` — finite number greater than `0`. Length of one simulation tick, in the same unit as elapsed time.
- `options.maxTicks` — integer greater than `0`. Maximum number of ticks one frame may run.

Returns a frozen object:

- `advance(elapsed)` — consume one positive finite elapsed time and return a step. A thrown error leaves the stored accumulator as it was.
- `reset()` — set the stored accumulator back to `0`.
- `accumulator` — stored remainder. After a successful advance it is `>= 0` and `< tickLength`.

Invalid options throw before a budget is returned.

### `advance(options)`

Pure function. The result depends only on `options`.

- `options.accumulator` — finite number `>= 0`. Omitted means `0`. Remainder from the previous step.
- `options.elapsed` — finite number `> 0`. Real time since the previous frame.
- `options.tickLength` — finite number `> 0`.
- `options.maxTicks` — integer `> 0`.

Returns a frozen step:

- `ticks` — integer from `0` through `maxTicks`. Run the simulation this many times.
- `alpha` — number in `[0, 1)`. Remainder divided by `tickLength`, for rendering between the previous tick state and the current one.
- `accumulator` — remainder to pass into the next call. Equal to `alpha * tickLength`.
- `dropped` — `true` when this frame discarded time past the catch-up cap.
- `droppedTime` — discarded time, in the same unit as `elapsed`. `0` when `dropped` is `false`.

### Errors

A non-object options value, or a value that is not a finite number, throws a `TypeError`.

`elapsed <= 0`, `tickLength <= 0`, `maxTicks <= 0`, a non-integer `maxTicks`, and `accumulator < 0` throw a `RangeError`.

A `RangeError` is also thrown when `accumulator + elapsed` is not finite, or when `tickLength * maxTicks` is not finite.

## Design notes

Pending time is the carried remainder plus the elapsed frame. A frame's budget is `maxTicks * tickLength`. When pending time is within that budget, the step runs every whole tick that fits and stores the leftover. The leftover is always shorter than one tick. Pass it back in as `accumulator` on the next frame. `alpha` is that leftover divided by `tickLength`, so a renderer can blend the previous tick state into the current one.

When pending time is longer than the budget, the extra is discarded. `dropped` is `true` and `droppedTime` is the discarded amount. The frame still runs exactly `maxTicks` ticks. The budget is a whole number of ticks, so a frame that discards time finishes on a tick boundary: the next accumulator is `0` and `alpha` is `0`. The following frame starts from that empty remainder. One slow frame cannot pile on an ever-growing number of catch-up ticks.

For values that add and multiply exactly, every step satisfies:

```text
ticks * tickLength + accumulator + droppedTime = previous accumulator + elapsed
```

Integer units such as milliseconds or microseconds keep that identity exact. Fractional units follow IEEE-754 arithmetic, so prefer an integer unit when totals must match bit for bit.

`advance` does not remember anything between calls. `createTickBudget` only remembers the accumulator. Nothing reads a clock, writes a global, or performs input or output.

## License

MIT. Copyright (c) 2026 Vadim Gubin.
