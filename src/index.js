function requireObject(value, name) {
  if (value === null || typeof value !== "object") {
    throw new TypeError(`${name} must be an object`);
  }
}

function requireFiniteNumber(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

function requirePositive(name, value) {
  requireFiniteNumber(name, value);
  if (value <= 0) {
    throw new RangeError(`${name} must be greater than 0`);
  }
}

function requireNonNegative(name, value) {
  requireFiniteNumber(name, value);
  if (value < 0) {
    throw new RangeError(`${name} must be greater than or equal to 0`);
  }
}

function requirePositiveInteger(name, value) {
  requireFiniteNumber(name, value);
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be an integer greater than 0`);
  }
}

function readLimits(options) {
  requireObject(options, "options");
  requirePositive("tickLength", options.tickLength);
  requirePositiveInteger("maxTicks", options.maxTicks);
  const limit = options.tickLength * options.maxTicks;
  if (!Number.isFinite(limit)) {
    throw new RangeError("tick budget is too large");
  }
  return {
    tickLength: options.tickLength,
    maxTicks: options.maxTicks,
    limit,
  };
}

function freezeStep(step) {
  return Object.freeze(step);
}

export function advance(options) {
  requireObject(options, "options");
  const accumulator =
    options.accumulator === undefined ? 0 : options.accumulator;
  requireNonNegative("accumulator", accumulator);
  requirePositive("elapsed", options.elapsed);
  const { tickLength, maxTicks, limit } = readLimits(options);
  const total = accumulator + options.elapsed;
  if (!Number.isFinite(total)) {
    throw new RangeError("accumulator and elapsed must sum to a finite number");
  }
  if (total > limit) {
    return freezeStep({
      ticks: maxTicks,
      alpha: 0,
      accumulator: 0,
      dropped: true,
      droppedTime: total - limit,
    });
  }
  const ticks = Math.floor(total / tickLength);
  let nextAccumulator = total - ticks * tickLength;
  if (nextAccumulator === 0) {
    nextAccumulator = 0;
  }
  return freezeStep({
    ticks,
    alpha: nextAccumulator / tickLength,
    accumulator: nextAccumulator,
    dropped: false,
    droppedTime: 0,
  });
}

export function createTickBudget(options) {
  const limits = readLimits(options);
  let accumulator = 0;
  return Object.freeze({
    advance(elapsed) {
      const step = advance({
        accumulator,
        elapsed,
        tickLength: limits.tickLength,
        maxTicks: limits.maxTicks,
      });
      accumulator = step.accumulator;
      return step;
    },
    reset() {
      accumulator = 0;
    },
    get accumulator() {
      return accumulator;
    },
  });
}
