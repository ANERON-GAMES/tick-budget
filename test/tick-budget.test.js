import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { advance, createTickBudget } from "../src/index.js";

function previousAccumulator(input) {
  return input.accumulator === undefined ? 0 : input.accumulator;
}

function assertContract(input, result) {
  const before = previousAccumulator(input);
  assert.equal(Number.isInteger(result.ticks), true);
  assert.ok(result.ticks >= 0 && result.ticks <= input.maxTicks);
  assert.ok(result.accumulator >= 0 && result.accumulator < input.tickLength);
  assert.equal(result.alpha, result.accumulator / input.tickLength);
  assert.ok(result.alpha >= 0 && result.alpha < 1);
  assert.ok(result.droppedTime >= 0);
  assert.equal(typeof result.dropped, "boolean");
  assert.equal(result.dropped, result.droppedTime > 0);
  assert.equal(
    result.ticks * input.tickLength + result.accumulator + result.droppedTime,
    before + input.elapsed,
  );
  if (result.dropped) {
    assert.equal(result.ticks, input.maxTicks);
    assert.equal(result.accumulator, 0);
    assert.equal(result.alpha, 0);
  }
}

function run(input) {
  const result = advance(input);
  assertContract(input, result);
  return result;
}

function expectThrow(fn, type, pattern) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof type);
    assert.match(error.message, pattern);
    return;
  }
  assert.fail("expected a throw");
}

describe("normal frames", () => {
  it("stores a short frame as remainder", () => {
    const input = {
      accumulator: 0,
      elapsed: 10,
      tickLength: 16,
      maxTicks: 5,
    };
    assert.deepEqual(run(input), {
      ticks: 0,
      alpha: 10 / 16,
      accumulator: 10,
      dropped: false,
      droppedTime: 0,
    });
  });

  it("runs one tick when elapsed equals the tick length", () => {
    const input = {
      accumulator: 0,
      elapsed: 16,
      tickLength: 16,
      maxTicks: 5,
    };
    assert.deepEqual(run(input), {
      ticks: 1,
      alpha: 0,
      accumulator: 0,
      dropped: false,
      droppedTime: 0,
    });
  });

  it("runs several ticks and keeps a partial remainder", () => {
    const input = {
      accumulator: 0,
      elapsed: 40,
      tickLength: 16,
      maxTicks: 5,
    };
    assert.deepEqual(run(input), {
      ticks: 2,
      alpha: 8 / 16,
      accumulator: 8,
      dropped: false,
      droppedTime: 0,
    });
  });

  it("consumes an exact number of ticks inside the cap", () => {
    const input = {
      accumulator: 0,
      elapsed: 48,
      tickLength: 16,
      maxTicks: 5,
    };
    assert.deepEqual(run(input), {
      ticks: 3,
      alpha: 0,
      accumulator: 0,
      dropped: false,
      droppedTime: 0,
    });
  });

  it("treats a missing accumulator as zero", () => {
    const input = { elapsed: 10, tickLength: 16, maxTicks: 5 };
    assert.deepEqual(run(input), {
      ticks: 0,
      alpha: 10 / 16,
      accumulator: 10,
      dropped: false,
      droppedTime: 0,
    });
  });

  it("supports a binary-exact fractional tick length", () => {
    const input = {
      accumulator: 0,
      elapsed: 1.25,
      tickLength: 0.5,
      maxTicks: 4,
    };
    assert.deepEqual(run(input), {
      ticks: 2,
      alpha: 0.5,
      accumulator: 0.25,
      dropped: false,
      droppedTime: 0,
    });
  });

  it("runs the whole budget when pending time lands on the cap", () => {
    const input = {
      accumulator: 0,
      elapsed: 32,
      tickLength: 16,
      maxTicks: 2,
    };
    assert.deepEqual(run(input), {
      ticks: 2,
      alpha: 0,
      accumulator: 0,
      dropped: false,
      droppedTime: 0,
    });
  });

  it("returns a frozen step", () => {
    const result = run({
      accumulator: 0,
      elapsed: 10,
      tickLength: 16,
      maxTicks: 4,
    });
    assert.equal(Object.isFrozen(result), true);
    expectThrow(
      () => {
        result.ticks = 9;
      },
      TypeError,
      /read only|Cannot assign/,
    );
  });
});

describe("remainder carry", () => {
  it("fires a tick once two short frames fill the tick length", () => {
    const first = run({
      accumulator: 0,
      elapsed: 10,
      tickLength: 16,
      maxTicks: 4,
    });
    const second = run({
      accumulator: first.accumulator,
      elapsed: 10,
      tickLength: 16,
      maxTicks: 4,
    });
    assert.deepEqual(first, {
      ticks: 0,
      alpha: 10 / 16,
      accumulator: 10,
      dropped: false,
      droppedTime: 0,
    });
    assert.deepEqual(second, {
      ticks: 1,
      alpha: 4 / 16,
      accumulator: 4,
      dropped: false,
      droppedTime: 0,
    });
  });

  it("keeps an explicit remainder across later frames", () => {
    const frames = [
      { elapsed: 10, ticks: 0, accumulator: 10, alpha: 10 / 16 },
      { elapsed: 10, ticks: 1, accumulator: 4, alpha: 4 / 16 },
      { elapsed: 4, ticks: 0, accumulator: 8, alpha: 8 / 16 },
      { elapsed: 7, ticks: 0, accumulator: 15, alpha: 15 / 16 },
      { elapsed: 1, ticks: 1, accumulator: 0, alpha: 0 },
    ];
    let accumulator = 0;
    for (const frame of frames) {
      const result = run({
        accumulator,
        elapsed: frame.elapsed,
        tickLength: 16,
        maxTicks: 4,
      });
      assert.equal(result.ticks, frame.ticks);
      assert.equal(result.accumulator, frame.accumulator);
      assert.equal(result.alpha, frame.alpha);
      assert.equal(result.dropped, false);
      accumulator = result.accumulator;
    }
  });

  it("does not retain state between pure calls", () => {
    const input = {
      accumulator: 0,
      elapsed: 10,
      tickLength: 16,
      maxTicks: 4,
    };
    const first = run(input);
    const second = run(input);
    assert.deepEqual(first, second);
    assert.notEqual(first, second);
    assert.equal(second.accumulator, 10);
  });

  it("preserves the time identity across a mixed sequence", () => {
    const frames = [10, 10, 4, 100, 16, 15, 1];
    const expected = [
      { ticks: 0, accumulator: 10, dropped: false, droppedTime: 0 },
      { ticks: 1, accumulator: 4, dropped: false, droppedTime: 0 },
      { ticks: 0, accumulator: 8, dropped: false, droppedTime: 0 },
      { ticks: 4, accumulator: 0, dropped: true, droppedTime: 44 },
      { ticks: 1, accumulator: 0, dropped: false, droppedTime: 0 },
      { ticks: 0, accumulator: 15, dropped: false, droppedTime: 0 },
      { ticks: 1, accumulator: 0, dropped: false, droppedTime: 0 },
    ];
    let accumulator = 0;
    frames.forEach((elapsed, index) => {
      const result = run({
        accumulator,
        elapsed,
        tickLength: 16,
        maxTicks: 4,
      });
      assert.equal(result.ticks, expected[index].ticks);
      assert.equal(result.accumulator, expected[index].accumulator);
      assert.equal(result.dropped, expected[index].dropped);
      assert.equal(result.droppedTime, expected[index].droppedTime);
      accumulator = result.accumulator;
    });
    assert.equal(accumulator, 0);
  });
});

describe("long frames hitting the cap", () => {
  it("runs only the capped tick count and reports the excess", () => {
    const input = {
      accumulator: 0,
      elapsed: 100,
      tickLength: 16,
      maxTicks: 3,
    };
    assert.deepEqual(run(input), {
      ticks: 3,
      alpha: 0,
      accumulator: 0,
      dropped: true,
      droppedTime: 52,
    });
  });

  it("drops a single unit past an exact cap", () => {
    const input = {
      accumulator: 0,
      elapsed: 49,
      tickLength: 16,
      maxTicks: 3,
    };
    assert.deepEqual(run(input), {
      ticks: 3,
      alpha: 0,
      accumulator: 0,
      dropped: true,
      droppedTime: 1,
    });
  });

  it("does not drop a frame that lands exactly on the cap", () => {
    const input = {
      accumulator: 0,
      elapsed: 48,
      tickLength: 16,
      maxTicks: 3,
    };
    assert.deepEqual(run(input), {
      ticks: 3,
      alpha: 0,
      accumulator: 0,
      dropped: false,
      droppedTime: 0,
    });
  });

  it("includes carried time when applying the cap", () => {
    const input = {
      accumulator: 15,
      elapsed: 34,
      tickLength: 16,
      maxTicks: 3,
    };
    assert.deepEqual(run(input), {
      ticks: 3,
      alpha: 0,
      accumulator: 0,
      dropped: true,
      droppedTime: 1,
    });
  });

  it("lets carried time land exactly on the cap without a drop", () => {
    const input = {
      accumulator: 15,
      elapsed: 33,
      tickLength: 16,
      maxTicks: 3,
    };
    assert.deepEqual(run(input), {
      ticks: 3,
      alpha: 0,
      accumulator: 0,
      dropped: false,
      droppedTime: 0,
    });
  });

  it("caps a one-tick budget", () => {
    const input = {
      accumulator: 0,
      elapsed: 100,
      tickLength: 16,
      maxTicks: 1,
    };
    assert.deepEqual(run(input), {
      ticks: 1,
      alpha: 0,
      accumulator: 0,
      dropped: true,
      droppedTime: 84,
    });
  });

  it("starts the next frame clean after a drop", () => {
    const capped = run({
      accumulator: 0,
      elapsed: 1000,
      tickLength: 16,
      maxTicks: 3,
    });
    assert.equal(capped.dropped, true);
    assert.equal(capped.accumulator, 0);
    const next = run({
      accumulator: capped.accumulator,
      elapsed: 10,
      tickLength: 16,
      maxTicks: 3,
    });
    assert.deepEqual(next, {
      ticks: 0,
      alpha: 10 / 16,
      accumulator: 10,
      dropped: false,
      droppedTime: 0,
    });
  });

  it("stays capped across repeated long frames", () => {
    let accumulator = 0;
    for (let index = 0; index < 5; index += 1) {
      const result = run({
        accumulator,
        elapsed: 1000,
        tickLength: 16,
        maxTicks: 3,
      });
      assert.equal(result.ticks, 3);
      assert.equal(result.dropped, true);
      assert.equal(result.accumulator, 0);
      accumulator = result.accumulator;
    }
  });

  it("drops fractional excess past a binary-exact budget", () => {
    const input = {
      accumulator: 0,
      elapsed: 2.25,
      tickLength: 0.5,
      maxTicks: 4,
    };
    assert.deepEqual(run(input), {
      ticks: 4,
      alpha: 0,
      accumulator: 0,
      dropped: true,
      droppedTime: 0.25,
    });
  });

  it("accepts a large finite frame without growing the tick count", () => {
    const input = {
      accumulator: 0,
      elapsed: 1_000_000,
      tickLength: 16,
      maxTicks: 3,
    };
    assert.deepEqual(run(input), {
      ticks: 3,
      alpha: 0,
      accumulator: 0,
      dropped: true,
      droppedTime: 999_952,
    });
  });
});

describe("zero and negative input rejection", () => {
  const valid = {
    accumulator: 0,
    elapsed: 16,
    tickLength: 16,
    maxTicks: 4,
  };

  it("rejects zero elapsed", () => {
    expectThrow(() => advance({ ...valid, elapsed: 0 }), RangeError, /elapsed/);
  });

  it("rejects negative elapsed", () => {
    expectThrow(
      () => advance({ ...valid, elapsed: -1 }),
      RangeError,
      /elapsed/,
    );
    expectThrow(
      () => advance({ ...valid, elapsed: -0.5 }),
      RangeError,
      /elapsed/,
    );
  });

  it("rejects zero tick length", () => {
    expectThrow(
      () => advance({ ...valid, tickLength: 0 }),
      RangeError,
      /tickLength/,
    );
    expectThrow(
      () => createTickBudget({ tickLength: 0, maxTicks: 4 }),
      RangeError,
      /tickLength/,
    );
  });

  it("rejects negative tick length", () => {
    expectThrow(
      () => advance({ ...valid, tickLength: -16 }),
      RangeError,
      /tickLength/,
    );
    expectThrow(
      () => createTickBudget({ tickLength: -1, maxTicks: 4 }),
      RangeError,
      /tickLength/,
    );
  });

  it("rejects zero max ticks", () => {
    expectThrow(
      () => advance({ ...valid, maxTicks: 0 }),
      RangeError,
      /maxTicks/,
    );
    expectThrow(
      () => createTickBudget({ tickLength: 16, maxTicks: 0 }),
      RangeError,
      /maxTicks/,
    );
  });

  it("rejects negative max ticks", () => {
    expectThrow(
      () => advance({ ...valid, maxTicks: -3 }),
      RangeError,
      /maxTicks/,
    );
    expectThrow(
      () => createTickBudget({ tickLength: 16, maxTicks: -1 }),
      RangeError,
      /maxTicks/,
    );
  });

  it("rejects a negative accumulator", () => {
    expectThrow(
      () => advance({ ...valid, accumulator: -1 }),
      RangeError,
      /accumulator/,
    );
    expectThrow(
      () => advance({ ...valid, accumulator: -0.25 }),
      RangeError,
      /accumulator/,
    );
  });

  it("leaves a budget unchanged when elapsed is zero or negative", () => {
    const budget = createTickBudget({ tickLength: 16, maxTicks: 4 });
    budget.advance(10);
    expectThrow(() => budget.advance(0), RangeError, /elapsed/);
    expectThrow(() => budget.advance(-5), RangeError, /elapsed/);
    assert.equal(budget.accumulator, 10);
    const result = budget.advance(6);
    assert.equal(result.ticks, 1);
    assert.equal(result.accumulator, 0);
    assert.equal(budget.accumulator, 0);
  });
});

describe("rejected values", () => {
  const valid = {
    accumulator: 0,
    elapsed: 16,
    tickLength: 16,
    maxTicks: 4,
  };

  it("rejects a fractional max tick count", () => {
    for (const maxTicks of [0.5, 1.5, 2.2]) {
      expectThrow(
        () => advance({ ...valid, maxTicks }),
        RangeError,
        /maxTicks/,
      );
      expectThrow(
        () => createTickBudget({ tickLength: 16, maxTicks }),
        RangeError,
        /maxTicks/,
      );
    }
  });

  it("rejects non-finite numbers", () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expectThrow(
        () => advance({ ...valid, elapsed: value }),
        TypeError,
        /elapsed/,
      );
      expectThrow(
        () => advance({ ...valid, tickLength: value }),
        TypeError,
        /tickLength/,
      );
      expectThrow(
        () => advance({ ...valid, maxTicks: value }),
        TypeError,
        /maxTicks/,
      );
      expectThrow(
        () => advance({ ...valid, accumulator: value }),
        TypeError,
        /accumulator/,
      );
    }
  });

  it("rejects non-numeric values", () => {
    for (const value of ["16", null, true, {}, []]) {
      expectThrow(
        () => advance({ ...valid, elapsed: value }),
        TypeError,
        /elapsed/,
      );
      expectThrow(
        () => advance({ ...valid, tickLength: value }),
        TypeError,
        /tickLength/,
      );
      expectThrow(
        () => advance({ ...valid, maxTicks: value }),
        TypeError,
        /maxTicks/,
      );
      expectThrow(
        () => advance({ ...valid, accumulator: value }),
        TypeError,
        /accumulator/,
      );
    }
  });

  it("rejects a missing elapsed value", () => {
    expectThrow(
      () => advance({ accumulator: 0, tickLength: 16, maxTicks: 4 }),
      TypeError,
      /elapsed/,
    );
  });

  it("rejects a non-object options value", () => {
    for (const value of [null, undefined, 1, "x", true]) {
      expectThrow(() => advance(value), TypeError, /options/);
      expectThrow(() => createTickBudget(value), TypeError, /options/);
    }
  });

  it("rejects an accumulator and elapsed that overflow", () => {
    expectThrow(
      () =>
        advance({
          accumulator: Number.MAX_VALUE,
          elapsed: Number.MAX_VALUE,
          tickLength: 1,
          maxTicks: 1,
        }),
      RangeError,
      /sum/,
    );
  });

  it("rejects a tick budget that cannot be represented", () => {
    expectThrow(
      () =>
        advance({
          accumulator: 0,
          elapsed: 1,
          tickLength: Number.MAX_VALUE,
          maxTicks: 4,
        }),
      RangeError,
      /tick budget/,
    );
    expectThrow(
      () =>
        createTickBudget({
          tickLength: Number.MAX_VALUE,
          maxTicks: 4,
        }),
      RangeError,
      /tick budget/,
    );
  });
});

describe("createTickBudget", () => {
  it("carries the remainder between advances", () => {
    const budget = createTickBudget({ tickLength: 16, maxTicks: 3 });
    const elapsedValues = [10, 10, 50];
    let accumulator = 0;
    for (const elapsed of elapsedValues) {
      const fromBudget = budget.advance(elapsed);
      const fromFunction = run({
        accumulator,
        elapsed,
        tickLength: 16,
        maxTicks: 3,
      });
      assert.deepEqual(fromBudget, fromFunction);
      assert.equal(budget.accumulator, fromFunction.accumulator);
      accumulator = fromFunction.accumulator;
    }
    assert.equal(budget.accumulator, 0);
  });

  it("resets the stored remainder", () => {
    const budget = createTickBudget({ tickLength: 16, maxTicks: 4 });
    budget.advance(10);
    assert.equal(budget.accumulator, 10);
    budget.reset();
    budget.reset();
    assert.equal(budget.accumulator, 0);
    const result = budget.advance(10);
    assert.equal(result.ticks, 0);
    assert.equal(result.accumulator, 10);
  });

  it("keeps separate budgets independent", () => {
    const first = createTickBudget({ tickLength: 16, maxTicks: 4 });
    const second = createTickBudget({ tickLength: 16, maxTicks: 4 });
    first.advance(10);
    assert.equal(first.accumulator, 10);
    assert.equal(second.accumulator, 0);
    second.advance(16);
    assert.equal(second.accumulator, 0);
    assert.equal(first.accumulator, 10);
  });

  it("freezes the budget object", () => {
    const budget = createTickBudget({ tickLength: 16, maxTicks: 4 });
    assert.equal(Object.isFrozen(budget), true);
    expectThrow(
      () => {
        budget.accumulator = 5;
      },
      TypeError,
      /read only|Cannot assign|getter/,
    );
    assert.equal(budget.accumulator, 0);
  });

  it("matches a capped pure step", () => {
    const budget = createTickBudget({ tickLength: 16, maxTicks: 3 });
    const fromBudget = budget.advance(100);
    const fromFunction = run({
      accumulator: 0,
      elapsed: 100,
      tickLength: 16,
      maxTicks: 3,
    });
    assert.deepEqual(fromBudget, fromFunction);
    assert.equal(budget.accumulator, 0);
  });
});
