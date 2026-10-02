/* Statistics for simple linear regression.
   Pure functions with no DOM access, so they can be tested in Node as well
   as used in the browser (where they are exposed as window.Stats). */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Stats = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LANCZOS = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
  ];

  /* Natural log of the gamma function (Lanczos approximation, z > 0). */
  function logGamma(z) {
    if (z < 0.5) {
      return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
    }
    z -= 1;
    var x = LANCZOS[0];
    for (var i = 1; i < LANCZOS.length; i++) {
      x += LANCZOS[i] / (z + i);
    }
    var t = z + 7.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }

  /* Continued fraction for the incomplete beta function (modified Lentz). */
  function betaContinuedFraction(a, b, x) {
    var MAX_ITERATIONS = 500;
    var EPSILON = 1e-14;
    var TINY = 1e-300;
    var qab = a + b;
    var qap = a + 1;
    var qam = a - 1;
    var c = 1;
    var d = 1 - (qab * x) / qap;
    if (Math.abs(d) < TINY) d = TINY;
    d = 1 / d;
    var h = d;
    for (var m = 1; m <= MAX_ITERATIONS; m++) {
      var m2 = 2 * m;
      var aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < TINY) d = TINY;
      c = 1 + aa / c;
      if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d;
      h *= d * c;
      aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < TINY) d = TINY;
      c = 1 + aa / c;
      if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d;
      var delta = d * c;
      h *= delta;
      if (Math.abs(delta - 1) < EPSILON) break;
    }
    return h;
  }

  /* Regularised incomplete beta function I_x(a, b). */
  function incompleteBeta(x, a, b) {
    if (!(x > 0)) return 0;
    if (x >= 1) return 1;
    var front = Math.exp(
      logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
    );
    if (x < (a + 1) / (a + b + 2)) {
      return (front * betaContinuedFraction(a, b, x)) / a;
    }
    return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
  }

  /* Two-sided p-value for a Student t statistic with df degrees of freedom. */
  function tTestTwoSided(t, df) {
    if (!(df > 0) || t !== t) return NaN;
    if (!isFinite(t)) return 0;
    var p = incompleteBeta(df / (df + t * t), df / 2, 0.5);
    return Math.min(1, Math.max(0, p));
  }

  /* True when a coordinate has no usable spread: its range is lost in the
     rounding noise of its own magnitude (or its sum of squares underflows).
     The test is relative, so the answer does not depend on the units or the
     offset of the data. */
  function hasNoSpread(min, max, sumOfSquares) {
    var magnitude = Math.max(Math.abs(min), Math.abs(max));
    return max - min <= 1e-12 * magnitude || !(sumOfSquares > 0);
  }

  /* Ordinary least squares fit of y = intercept + slope * x.

     Returns an object whose `status` is one of
       'empty'    no points
       'single'   one point (no line)
       'vertical' every point shares the same x (slope undefined)
       'ok'       a line was fitted
     Quantities that are mathematically undefined for the data are NaN. */
  function linearRegression(points) {
    var n = points.length;
    var result = {
      status: 'ok',
      n: n,
      df: n - 2,
      meanX: NaN,
      meanY: NaN,
      slope: NaN,
      intercept: NaN,
      r: NaN,
      r2: NaN,
      sse: NaN,
      residualSE: NaN,
      slopeSE: NaN,
      t: NaN,
      p: NaN
    };

    if (n === 0) {
      result.status = 'empty';
      return result;
    }

    var i;
    var sumX = 0;
    var sumY = 0;
    var minX = Infinity;
    var maxX = -Infinity;
    var minY = Infinity;
    var maxY = -Infinity;
    for (i = 0; i < n; i++) {
      var x = points[i].x;
      var y = points[i].y;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    var meanX = sumX / n;
    var meanY = sumY / n;
    result.meanX = meanX;
    result.meanY = meanY;

    if (n === 1) {
      result.status = 'single';
      return result;
    }

    var sxx = 0;
    var syy = 0;
    var sxy = 0;
    for (i = 0; i < n; i++) {
      var dx = points[i].x - meanX;
      var dy = points[i].y - meanY;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }

    /* Identical x-values can still leave a tiny non-zero sxx, because their
       mean is not always exactly representable; hasNoSpread absorbs that. */
    if (hasNoSpread(minX, maxX, sxx)) {
      result.status = 'vertical';
      return result;
    }
    var flat = hasNoSpread(minY, maxY, syy);

    var slope = flat ? 0 : sxy / sxx;
    var intercept = meanY - slope * meanX;
    result.slope = slope;
    result.intercept = intercept;

    var sse = 0;
    if (!flat) {
      for (i = 0; i < n; i++) {
        var e = points[i].y - (intercept + slope * points[i].x);
        sse += e * e;
      }
      if (sse <= 1e-12 * syy) sse = 0;
    }
    result.sse = sse;

    if (!flat) {
      var r = sxy / Math.sqrt(sxx * syy);
      r = Math.max(-1, Math.min(1, r));
      result.r = r;
      result.r2 = Math.max(0, Math.min(1, 1 - sse / syy));
    }

    if (result.df > 0) {
      var s = Math.sqrt(sse / result.df);
      result.residualSE = s;
      result.slopeSE = s / Math.sqrt(sxx);
      if (!flat) {
        result.t = result.slopeSE === 0
          ? (slope > 0 ? Infinity : -Infinity)
          : slope / result.slopeSE;
        result.p = tTestTwoSided(result.t, result.df);
      }
    }

    return result;
  }

  return {
    logGamma: logGamma,
    incompleteBeta: incompleteBeta,
    tTestTwoSided: tTestTwoSided,
    linearRegression: linearRegression
  };
});
